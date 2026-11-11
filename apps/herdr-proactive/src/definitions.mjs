// A deliberately flat scalar format, not a general YAML parser.
export function definitionId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][-a-z0-9]{0,63}$/.test(value)) {
    throw new Error('Folder IDs must start with a lowercase letter or digit and contain only lowercase letters, digits and hyphens (max 64)');
  }
  return value;
}

function scalar(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    const match = /^("(?:[^"\\]|\\.)*")(?:\s+#.*)?$/.exec(value);
    if (!match) throw new Error('Malformed quoted scalar');
    const parsed = JSON.parse(match[1]);
    if (typeof parsed !== 'string') throw new Error('Expected a scalar string');
    return parsed;
  }
  if (value.startsWith("'")) {
    const match = /^'((?:[^']|'')*)'(?:\s+#.*)?$/.exec(value);
    if (!match) throw new Error('Malformed quoted scalar');
    return match[1].replaceAll("''", "'");
  }
  const plain = value.replace(/\s+#.*$/, '').trim();
  if (!plain || /^[#\[\]{}|>&*!]/.test(plain)) throw new Error('Expected a flat scalar value');
  if (plain === 'true' || plain === 'false') return plain === 'true';
  return plain;
}

function parse(text) {
  if (typeof text !== 'string') throw new Error('Expected definition text');
  const opening = /^(?:\uFEFF)?---\r?\n/.exec(text);
  if (!opening) throw new Error('Definition must begin with --- frontmatter');
  const rest = text.slice(opening[0].length);
  const closing = /^---(?:\r?\n|$)/m.exec(rest);
  if (!closing) throw new Error('Missing closing frontmatter ---');
  const lines = rest.slice(0, closing.index).replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const data = Object.create(null);
  const entries = new Map();
  lines.forEach((line, index) => {
    if (!line.trim() || /^\s*#/.test(line)) return;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Malformed frontmatter line ${index + 2}: expected key: scalar`);
    if (Object.hasOwn(data, match[1])) throw new Error(`Duplicate frontmatter key: ${match[1]}`);
    data[match[1]] = scalar(match[2]);
    entries.set(match[1], index);
  });
  return { data, entries, lines, body: rest.slice(closing.index + closing[0].length) };
}

function string(value, key) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key}: expected a nonempty string`);
  return value.trim();
}
function flag(value, key, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${key}: expected true or false`);
  return value;
}
function integer(value, key, min, max) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key}: expected an integer from ${min} to ${max}`);
  return value;
}
const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const clock = '([01]\\d|2[0-3]):[0-5]\\d';
function timestamp(value, key) {
  const text = string(value, key);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new Error(`${key}: expected an ISO datetime with Z or an explicit offset`);
  }
  const date = text.slice(0, 10);
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`${key}: invalid date`);
  return Date.parse(text);
}
function readSchedule(data) {
  if (data.timezone !== 'UTC') throw new Error('timezone: UTC is required');
  const value = string(data.schedule, 'schedule');
  let match = /^every ([1-9]\d*)(m|h)$/.exec(value);
  if (match) {
    const minutes = integer(Number(match[1]) * (match[2] === 'h' ? 60 : 1), 'Interval minutes', 1, 525600);
    return { kind: 'interval', minutes, ...(data.anchor === undefined ? {} : { anchor: timestamp(data.anchor, 'anchor') }) };
  }
  if (data.anchor !== undefined) throw new Error('anchor is only supported for interval schedules');
  match = new RegExp(`^daily (${clock})$`).exec(value);
  if (match) return { kind: 'daily', time: match[1] };
  match = new RegExp(`^weekly ((?:sun|mon|tue|wed|thu|fri|sat)(?:,(?:sun|mon|tue|wed|thu|fri|sat))*) (${clock})$`).exec(value);
  if (match) {
    const days = match[1].split(',').map(day => weekdays.indexOf(day));
    if (new Set(days).size !== days.length) throw new Error('Duplicate weekday in schedule');
    return { kind: 'weekly', days: days.sort(), time: match[2] };
  }
  if (value.startsWith('at ')) return { kind: 'once', at: timestamp(value.slice(3), 'schedule') };
  throw new Error('schedule: use every 30m, every 5h, daily 09:00, weekly mon,thu 09:00 or at <ISO datetime>');
}

export function readDefinition(text, kind) {
  const { data, body } = parse(text);
  const name = string(data.title, 'title');
  const enabled = flag(data.enabled, 'enabled', kind === 'pulse');
  if (kind === 'pulse') {
    if (!body.trim()) throw new Error('Pulse instructions must not be empty');
    return { name, policy: definitionId(data.policy), enabled, prompt: body, schedule: readSchedule(data) };
  }
  if (kind !== 'policy') throw new Error('Definition kind must be policy or pulse');
  const scope = data.scope ?? 'workspace';
  if (!['workspace', 'thread'].includes(scope)) throw new Error('scope: use workspace or thread');
  const mode = data.mode ?? 'adaptive';
  if (!['adaptive', 'fixed', 'off'].includes(mode)) throw new Error('mode: use adaptive, fixed or off');
  if (mode !== 'off' && !body.trim()) throw new Error('Generic instructions must not be empty unless mode is off');
  const quiet = /^([01]\d|2[0-3]):00-([01]\d|2[0-3]):00 UTC$/.exec(string(data.quietHours, 'quietHours'));
  if (!quiet) throw new Error('quietHours: use HH:00-HH:00 UTC');
  const allowTerminalInput = flag(data.allowTerminalInput, 'allowTerminalInput', false);
  if (enabled && !allowTerminalInput) throw new Error('Enabling a policy requires allowTerminalInput: true');
  return { name, scope, terminal: string(data.recipient, 'recipient'), enabled, mode,
    minMinutes: integer(data.minMinutes ?? 240, 'minMinutes', 15, 43200),
    quietStart: Number(quiet[1]), quietEnd: Number(quiet[2]), allowTerminalInput, prompt: body };
}

function scheduleHeaders(schedule) {
  if (!schedule || typeof schedule !== 'object') throw new Error('Expected a schedule');
  const { kind } = schedule;
  let value;
  if (kind === 'interval') {
    const minutes = integer(schedule.minutes, 'Interval minutes', 1, 525600);
    value = minutes % 60 ? `every ${minutes}m` : `every ${minutes / 60}h`;
  } else if (kind === 'once') value = `at ${iso(schedule.at)}`;
  else if (kind === 'daily') value = `daily ${schedule.time}`;
  else if (kind === 'weekly') {
    if (!Array.isArray(schedule.days) || !schedule.days.length) throw new Error('Expected weekdays');
    value = `weekly ${schedule.days.map(day => weekdays[integer(day, 'Weekday', 0, 6)]).join(',')} ${schedule.time}`;
  } else throw new Error('Unsupported schedule kind');
  return { schedule: value, timezone: 'UTC', ...(kind === 'interval' && schedule.anchor !== undefined ? { anchor: iso(schedule.anchor) } : {}) };
}
function iso(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 8640000000000000) throw new Error('Expected a valid timestamp');
  return new Date(value).toISOString();
}
function inlineComment(line) {
  // Only a whitespace-prefixed # outside a quoted scalar starts a comment.
  const raw = line.slice(line.indexOf(':') + 1).trimStart();
  const match = raw.startsWith('"') ? /^("(?:[^"\\]|\\.)*")(\s+#.*)$/.exec(raw)
    : raw.startsWith("'") ? /^'((?:[^']|'')*)'(\s+#.*)$/.exec(raw) : /^(.*?)(\s+#.*)$/.exec(raw);
  return match?.[2] ?? '';
}

export function writeDefinition(value, kind, existingText) {
  let headers;
  if (kind === 'policy') headers = { title: value.name, scope: value.scope, recipient: value.terminal,
    enabled: value.enabled, mode: value.mode, minMinutes: value.minMinutes,
    quietHours: `${String(value.quietStart).padStart(2, '0')}:00-${String(value.quietEnd).padStart(2, '0')}:00 UTC`,
    allowTerminalInput: value.allowTerminalInput };
  else if (kind === 'pulse') headers = { title: value.name, policy: value.policy, enabled: value.enabled, ...scheduleHeaders(value.schedule) };
  else throw new Error('Definition kind must be policy or pulse');
  if (typeof value.prompt !== 'string') throw new Error('Expected Markdown instructions');
  for (const [key, entry] of Object.entries(headers)) if (entry === undefined) throw new Error(`Missing ${key}`);
  const previous = existingText === undefined ? { lines: [], entries: new Map(), data: {} } : parse(existingText);
  const lines = [...previous.lines];
  for (const [key, entry] of Object.entries(headers)) {
    if (previous.data[key] === entry) continue;
    const encoded = typeof entry === 'string' ? JSON.stringify(entry) : String(entry);
    const index = previous.entries.get(key);
    if (index === undefined) lines.push(`${key}: ${encoded}`);
    else lines[index] = `${key}: ${encoded}${inlineComment(lines[index])}`;
  }
  if (kind === 'pulse' && !Object.hasOwn(headers, 'anchor') && previous.entries.has('anchor')) {
    const index = previous.entries.get('anchor');
    const comment = inlineComment(lines[index]).trimStart();
    if (comment) lines[index] = comment;
    else lines.splice(index, 1);
  }
  const result = `---\n${lines.join('\n')}\n---\n${value.prompt}`;
  readDefinition(result, kind);
  return result;
}

// Catalog ownership discovery must work even for an otherwise invalid pulse.
export function definitionPolicy(text) { return parse(text).data.policy; }
