import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
function text(value, name, max = 64000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name}: expected 1–${max} characters`);
  return value.trim();
}
function instructions(value, name, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > 64000 || (!allowEmpty && !value.trim())) {
    throw new Error(`${name}: enter Markdown instructions, at most 64000 characters`);
  }
  return value;
}
function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name}: expected an integer from ${min} to ${max}`);
  return value;
}
function flag(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name}: expected true or false`);
  return value;
}
export function binding(terminal) {
  return { created: terminal.created_ms, pid: terminal.foreground?.pid ?? terminal.pid };
}
export function sameBinding(saved, terminal) {
  return saved?.created === terminal?.created_ms && saved?.pid != null && saved.pid === binding(terminal).pid;
}

export function validateSchedule(value) {
  if (!object(value)) throw new Error('Choose a schedule');
  if (value.kind === 'interval') return { kind: value.kind,
    minutes: integer(value.minutes, 'Interval minutes', 1, 525600),
    ...(value.anchor === undefined ? {} : { anchor: integer(value.anchor, 'Interval start', 1, 8640000000000000) }) };
  if (value.kind === 'once') return { kind: value.kind, at: integer(value.at, 'Run time', 1, 8640000000000000) };
  if (!['daily', 'weekly'].includes(value.kind) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) {
    throw new Error('Use an interval, one-off date, daily time or weekly time in UTC');
  }
  const schedule = { kind: value.kind, time: value.time };
  if (value.kind === 'weekly') {
    if (!Array.isArray(value.days) || !value.days.length) throw new Error('Select at least one weekday');
    schedule.days = [...new Set(value.days.map(day => integer(day, 'Weekday', 0, 6)))].sort();
  }
  return schedule;
}

export function validatePolicy(input, old, terminal, now = Date.now()) {
  if (!object(input)) throw new Error('Expected a policy object');
  const space = text(input.space, 'Workspace', 128);
  const address = text(input.terminal, 'Recipient', 64);
  const enabled = flag(input.enabled ?? false, 'Enabled');
  const allowTerminalInput = flag(input.allowTerminalInput ?? false, 'Terminal input consent');
  if (enabled && !allowTerminalInput) throw new Error('Acknowledge terminal input before enabling');
  if (!['adaptive', 'fixed', 'off'].includes(input.mode)) throw new Error('Choose adaptive, fixed or off');
  const scope = input.scope ?? 'workspace';
  if (!['workspace', 'thread'].includes(scope)) throw new Error('Choose workspace or thread scope');
  if (!Array.isArray(input.jobs ?? [])) throw new Error('Expected a list of scheduled prompts');
  const ids = new Set();
  const jobs = (input.jobs ?? []).map(job => {
    if (!object(job)) throw new Error('Expected a job object');
    const id = text(job.id ?? randomUUID(), 'Job ID', 64);
    if (ids.has(id)) throw new Error('Job IDs must be unique');
    ids.add(id);
    const enabled = flag(job.enabled ?? true, 'Job enabled');
    const schedule = validateSchedule(job.schedule);
    const previous = old?.jobs.find(item => item.id === id);
    const unchanged = previous && isDeepStrictEqual(previous.schedule, schedule) && (previous.enabled || !enabled);
    return { ...job, id, name: text(job.name, 'Job name', 100), enabled,
      prompt: instructions(job.prompt, 'Job prompt'), schedule,
      createdAt: unchanged ? previous.createdAt : now };
  });
  const unchanged = old?.space === space && old?.terminal === address;
  let targetBinding = unchanged ? old.binding : null;
  // Saving an unchanged policy must not silently bind it to a replacement program.
  if (!targetBinding || input.rebind === true) {
    if (!terminal || terminal.state !== 'live' || !terminal.reported || !terminal.status ||
        terminal.labels?.['herdr.space'] !== space || !binding(terminal).pid) {
      throw new Error('Choose a live, status-reporting agent in this workspace');
    }
    targetBinding = binding(terminal);
  }
  return { ...input, id: old?.id ?? text(input.id ?? randomUUID(), 'Policy ID', 100),
    name: text(input.name, 'Policy name', 100), scope, space, terminal: address, binding: targetBinding,
    enabled, allowTerminalInput, mode: input.mode, prompt: instructions(input.prompt, 'Check-in prompt', input.mode === 'off'),
    minMinutes: integer(input.minMinutes ?? 240, 'Minimum minutes', 15, 43200),
    quietStart: integer(input.quietStart ?? 22, 'Quiet start hour UTC', 0, 23),
    quietEnd: integer(input.quietEnd ?? 8, 'Quiet end hour UTC', 0, 23), jobs,
    enabledAt: old?.enabled && enabled ? old.enabledAt : now,
    snoozedUntil: old?.snoozedUntil ?? 0, manualRequest: old?.manualRequest ?? null,
    acknowledgeRequest: old?.acknowledgeRequest ?? null };
}
