import { fields, scalar, encode, decode, columns, upsert, pruneRows } from './database-rows.mjs';

const runtimeSpec = {
  phase: 'string', reason: 'string', lastGenericAt: 'number', lastDispatchAt: 'number', lastEngagementAt: 'number',
  pendingUnseen: 'boolean', awaitingAck: 'boolean', enabledAt: 'number', sourceEnabled: 'boolean',
  snoozedUntil: 'number', nextAt: 'number', dispatchTurn: 'integer', lastError: 'string',
  manualRequest: 'string', acknowledgeRequest: 'string',
};
const receiptSpec = { id: 'string', terminal: 'string', kind: 'string', job: 'string', path: 'string', at: 'number', outcome: 'string', error: 'string' };
const pulseSpec = { lastAt: 'number', createdAt: 'number', enabled: 'boolean', kind: 'string', minutes: 'number', anchor: 'number', at: 'number', time: 'string', days: 'integer' };

export const runtimeSchema = `
CREATE TABLE policy_runtime (id TEXT PRIMARY KEY,${columns(runtimeSpec)},jobs_present INTEGER NOT NULL,definitions_present INTEGER NOT NULL,receipts_present INTEGER NOT NULL,inflight_state INTEGER NOT NULL CHECK(inflight_state IN(0,1,2)));
CREATE TABLE pulse_cursor (policy TEXT NOT NULL REFERENCES policy_runtime(id) ON DELETE CASCADE,job TEXT NOT NULL,${columns(pulseSpec)},definition_present INTEGER NOT NULL,schedule_present INTEGER NOT NULL,PRIMARY KEY(policy,job));
CREATE TABLE receipt (policy TEXT NOT NULL REFERENCES policy_runtime(id) ON DELETE CASCADE,slot INTEGER NOT NULL CHECK(slot BETWEEN -1 AND 31),${columns(receiptSpec)},PRIMARY KEY(policy,slot));`;

function encodePulse(job, lastAt, definition, hasCursor) {
  if (hasCursor && (typeof lastAt !== 'number' || !Number.isFinite(lastAt) || lastAt < 0)) throw new TypeError('Invalid pulse cursor');
  if (definition !== undefined) fields(definition, ['createdAt', 'enabled', 'schedule']);
  const schedule = definition?.schedule;
  if (schedule !== undefined) fields(schedule, ['kind', 'minutes', 'anchor', 'at', 'time', 'days']);
  let days = schedule?.days;
  if (days !== undefined && days !== null) {
    if (!Array.isArray(days) || days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(days).size !== days.length) throw new TypeError('Invalid pulse weekdays');
    days = days.reduce((mask, day) => mask + 2 ** day, 0);
  }
  const values = {};
  if (hasCursor) values.lastAt = lastAt;
  if (definition) {
    if (Object.hasOwn(definition, 'createdAt')) values.createdAt = definition.createdAt;
    if (Object.hasOwn(definition, 'enabled')) values.enabled = definition.enabled;
  }
  if (schedule) Object.assign(values, schedule, Object.hasOwn(schedule, 'days') ? { days } : {});
  return { job, ...encode(values, pulseSpec), definition_present: definition === undefined ? 0 : 1, schedule_present: schedule === undefined ? 0 : 1 };
}

function writePolicy(db, id, runtime) {
  fields(runtime, [...Object.keys(runtimeSpec), 'jobs', 'jobDefinitions', 'receipts', 'inflight']);
  const { jobs, jobDefinitions, receipts, inflight, ...rest } = runtime;
  if (jobs !== undefined) fields(jobs, Object.keys(jobs ?? {}));
  if (jobDefinitions !== undefined) fields(jobDefinitions, Object.keys(jobDefinitions ?? {}));
  if (receipts !== undefined && !Array.isArray(receipts)) throw new TypeError('Expected receipt list');
  upsert(db, 'policy_runtime', ['id'], { id, ...encode(rest, runtimeSpec), jobs_present: jobs === undefined ? 0 : 1,
    definitions_present: jobDefinitions === undefined ? 0 : 1, receipts_present: receipts === undefined ? 0 : 1,
    inflight_state: inflight === undefined ? 0 : inflight === null ? 1 : 2 });
  const pulses = [...new Set([...Object.keys(jobs ?? {}), ...Object.keys(jobDefinitions ?? {})])].map(job => ({ policy: id,
    ...encodePulse(job, jobs?.[job], jobDefinitions?.[job], Object.hasOwn(jobs ?? {}, job)) }));
  pulses.forEach(row => upsert(db, 'pulse_cursor', ['policy', 'job'], row));
  pruneRows(db, 'pulse_cursor', ['policy', 'job'], pulses, 'WHERE policy=?', [id]);
  const rows = (receipts ?? []).slice(-32).map((receipt, slot) => ({ policy: id, slot, ...encode(receipt, receiptSpec) }));
  if (inflight != null) rows.push({ policy: id, slot: -1, ...encode(inflight, receiptSpec) });
  rows.forEach(row => upsert(db, 'receipt', ['policy', 'slot'], row));
  pruneRows(db, 'receipt', ['policy', 'slot'], rows, 'WHERE policy=?', [id]);
}

export function runtimeStore(db, transaction) {
  return {
    readRuntime: () => transaction(() => {
      const policies = {};
      for (const row of db.prepare('SELECT * FROM policy_runtime ORDER BY id').all()) {
        const runtime = decode(row, runtimeSpec);
        if (row.jobs_present) runtime.jobs = {};
        if (row.definitions_present) runtime.jobDefinitions = {};
        if (row.receipts_present) runtime.receipts = [];
        if (row.inflight_state) runtime.inflight = null;
        Object.defineProperty(policies, row.id, { value: runtime, enumerable: true, writable: true, configurable: true });
      }
      for (const row of db.prepare('SELECT * FROM pulse_cursor ORDER BY policy,job').all()) {
        const runtime = policies[row.policy], pulse = decode(row, pulseSpec);
        if (Object.hasOwn(pulse, 'lastAt')) Object.defineProperty(runtime.jobs, row.job, { value: pulse.lastAt, enumerable: true, writable: true, configurable: true });
        if (row.definition_present) {
          const definition = {};
          for (const key of ['createdAt', 'enabled']) if (Object.hasOwn(pulse, key)) definition[key] = pulse[key];
          if (row.schedule_present) {
            definition.schedule = {};
            for (const key of ['kind', 'minutes', 'anchor', 'at', 'time', 'days']) if (Object.hasOwn(pulse, key)) definition.schedule[key] = key === 'days' && pulse.days !== null ? Array.from({ length: 7 }, (_, day) => day).filter(day => pulse.days & 2 ** day) : pulse[key];
          }
          Object.defineProperty(runtime.jobDefinitions, row.job, { value: definition, enumerable: true, writable: true, configurable: true });
        }
      }
      for (const row of db.prepare('SELECT * FROM receipt ORDER BY policy,slot').all()) {
        const receipt = decode(row, receiptSpec);
        if (row.slot === -1) policies[row.policy].inflight = receipt;
        else policies[row.policy].receipts.push(receipt);
      }
      return { version: 1, policies, reset: db.prepare('SELECT runtime_reset FROM workspace_metadata WHERE id=1').get().runtime_reset };
    }, false),
    writeRuntime: snapshot => transaction(() => {
      fields(snapshot, ['version', 'policies', 'reset']);
      if (snapshot.version !== 1 || !Object.hasOwn(snapshot, 'reset')) throw new TypeError('Unsupported runtime snapshot');
      scalar(snapshot.reset, 'string'); fields(snapshot.policies, Object.keys(snapshot.policies ?? {}));
      for (const [id, runtime] of Object.entries(snapshot.policies)) writePolicy(db, id, runtime);
      pruneRows(db, 'policy_runtime', ['id'], Object.keys(snapshot.policies).map(id => ({ id })));
      db.prepare('UPDATE workspace_metadata SET runtime_reset=? WHERE id=1 AND runtime_reset IS NOT ?').run(snapshot.reset, snapshot.reset);
    }),
  };
}
