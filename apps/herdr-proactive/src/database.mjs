import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, closeSync, chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { runtimeStore, runtimeSchema } from './database-runtime.mjs';
import { activityStore, activitySchema } from './database-activity.mjs';

import { fields, scalar, encode, decode, columns, upsert, pruneRows } from './database-rows.mjs';

const controlSpec = { terminal: 'string', snoozedUntil: 'number', manualRequest: 'string', acknowledgeRequest: 'string' };
const bindingSpec = { created: 'number', pid: 'integer' };
const serviceSpec = { coreId: 'string', pid: 'integer', startedAt: 'number', observedAt: 'number', error: 'string' };

const schema = `
CREATE TABLE workspace_metadata (id INTEGER PRIMARY KEY CHECK(id=1),control_revision INTEGER NOT NULL DEFAULT 0,control_reset TEXT,runtime_reset TEXT);
INSERT INTO workspace_metadata(id) VALUES(1);
CREATE TABLE policy_control (id TEXT PRIMARY KEY,${columns(controlSpec)},binding_state INTEGER NOT NULL CHECK(binding_state IN(0,1,2)),binding_created REAL,binding_pid INTEGER,binding_present INTEGER NOT NULL,binding_nulls INTEGER NOT NULL);
CREATE TABLE service_metadata (id INTEGER PRIMARY KEY CHECK(id=1),${columns(serviceSpec)});
${runtimeSchema}
${activitySchema}
PRAGMA user_version=1;`;

export function openWorkspaceDatabase(path, { readOnly = false, create = true } = {}) {
  const exists = existsSync(path);
  if (!exists && (!create || readOnly)) return null;
  if (!readOnly) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (!exists) {
      try { closeSync(openSync(path, 'wx', 0o600)); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    chmodSync(path, 0o600);
  }
  const db = new DatabaseSync(path, { readOnly });
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version !== 0 && version !== 1) throw new Error(`Unsupported bookkeeping database version: ${version}`);
    if (version === 0) {
      if (readOnly) throw new Error('Uninitialized bookkeeping database');
      db.exec('BEGIN IMMEDIATE');
      try {
        // Another creator may have initialized while this connection waited.
        const lockedVersion = db.prepare('PRAGMA user_version').get().user_version;
        if (lockedVersion === 0) db.exec(schema);
        else if (lockedVersion !== 1) throw new Error(`Unsupported bookkeeping database version: ${lockedVersion}`);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    if (!readOnly) db.exec('PRAGMA journal_mode=WAL;');
    function synchronous(value) {
      if (value && typeof value.then === 'function') {
        // Reject the edit visibly without leaving its rejected async result as
        // an unrelated unhandled rejection after rollback.
        Promise.resolve(value).catch(() => {});
        throw new TypeError('Bookkeeping edits must be synchronous');
      }
      return value;
    }
    function transaction(edit, write = true) {
      db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
      try {
        const result = synchronous(edit());
        db.exec('COMMIT');
        return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    function readControl() {
      const metadata = db.prepare('SELECT control_revision,control_reset FROM workspace_metadata WHERE id=1').get();
      const policies = {};
      for (const row of db.prepare('SELECT * FROM policy_control ORDER BY id').all()) {
        const record = decode(row, controlSpec);
        if (row.binding_state) record.binding = row.binding_state === 1 ? null : decode({ created: row.binding_created, pid: row.binding_pid, present: row.binding_present, nulls: row.binding_nulls }, bindingSpec);
        Object.defineProperty(policies, row.id, { value: record, enumerable: true, writable: true, configurable: true });
      }
      return { value: { version: 1, policies, reset: metadata.control_reset }, revision: metadata.control_revision };
    }
    function editControl(edit) {
      return transaction(() => {
        const before = readControl();
        const replacement = synchronous(edit(before.value));
        const value = replacement ?? before.value;
        fields(value, ['version', 'policies', 'reset']);
        if (value.version !== 1 || !Object.hasOwn(value, 'reset')) throw new TypeError('Unsupported controls');
        scalar(value.reset, 'string'); fields(value.policies, Object.keys(value.policies ?? {}));
        const rows = Object.entries(value.policies).map(([id, record]) => {
          fields(record, [...Object.keys(controlSpec), 'binding']);
          const { binding, ...rest } = record;
          const bound = binding == null ? { present: 0, nulls: 0, created: null, pid: null } : encode(binding, bindingSpec);
          return { id, ...encode(rest, controlSpec), binding_state: binding === undefined ? 0 : binding === null ? 1 : 2,
            binding_created: bound.created, binding_pid: bound.pid, binding_present: bound.present, binding_nulls: bound.nulls };
        });
        const changes = db.prepare('SELECT total_changes() AS n').get().n;
        rows.forEach(row => upsert(db, 'policy_control', ['id'], row));
        pruneRows(db, 'policy_control', ['id'], rows);
        db.prepare('UPDATE workspace_metadata SET control_reset=? WHERE id=1 AND control_reset IS NOT ?').run(value.reset, value.reset);
        if (db.prepare('SELECT total_changes() AS n').get().n !== changes) db.exec('UPDATE workspace_metadata SET control_revision=control_revision+1 WHERE id=1');
        return readControl();
      });
    }
    return {
      close: () => db.close(),
      readControl: () => transaction(readControl, false), editControl,
      readControlRevision: () => db.prepare('SELECT control_revision FROM workspace_metadata WHERE id=1').get().control_revision,
      ...runtimeStore(db, transaction), ...activityStore(db, transaction),
      readService: () => ({ service: (() => { const row = db.prepare('SELECT * FROM service_metadata WHERE id=1').get(); return row ? decode(row, serviceSpec) : {}; })() }),
      writeService: snapshot => transaction(() => { fields(snapshot, ['service']); upsert(db, 'service_metadata', ['id'], { id: 1, ...encode(snapshot.service, serviceSpec) }); }),
    };
  } catch (error) { db.close(); throw error; }
}
