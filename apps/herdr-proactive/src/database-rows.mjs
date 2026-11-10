// Optional-field masks distinguish absent properties from explicit nulls without
// encoding objects. Every stored value remains an independently queryable scalar.
export function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a bookkeeping record');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`Unknown bookkeeping field: ${key}`);
}

export function scalar(value, type) {
  if (value === undefined || value === null) return null;
  if (type === 'boolean') {
    if (typeof value !== 'boolean') throw new TypeError('Expected boolean bookkeeping value');
    return value ? 1 : 0;
  }
  if (type === 'number' ? !Number.isFinite(value) : type === 'integer' ? !Number.isSafeInteger(value) : typeof value !== 'string') {
    throw new TypeError(`Expected ${type} bookkeeping value`);
  }
  return value;
}

export function encode(value, spec) {
  fields(value, Object.keys(spec));
  let present = 0, nulls = 0;
  const row = {};
  Object.entries(spec).forEach(([key, type], bit) => {
    if (Object.hasOwn(value, key) && value[key] !== undefined) {
      present += 2 ** bit;
      if (value[key] === null) nulls += 2 ** bit;
    }
    row[key] = scalar(value[key], type);
  });
  return { ...row, present, nulls };
}

export function decode(row, spec) {
  const value = {};
  Object.entries(spec).forEach(([key, type], bit) => {
    if (!(row.present & 2 ** bit)) return;
    value[key] = row.nulls & 2 ** bit ? null : type === 'boolean' ? row[key] === 1 : row[key];
  });
  return value;
}

export function columns(spec) {
  return Object.entries(spec).map(([key, type]) => `${key} ${type === 'string' ? 'TEXT' : type === 'number' ? 'REAL' : 'INTEGER'}${type === 'boolean' ? ` CHECK (${key} IN (0,1) OR ${key} IS NULL)` : ''}`).join(',') + ',present INTEGER NOT NULL,nulls INTEGER NOT NULL';
}

export function upsert(db, table, keys, row) {
  const names = Object.keys(row), values = names.map(key => row[key]);
  const updates = names.filter(key => !keys.includes(key));
  db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')}) ON CONFLICT (${keys.join(',')}) DO UPDATE SET ${updates.map(key => `${key}=excluded.${key}`).join(',')} WHERE ${updates.map(key => `${table}.${key} IS NOT excluded.${key}`).join(' OR ')}`).run(...values);
}

export function pruneRows(db, table, keys, desired, where = '', args = []) {
  // Compare primary keys rather than rewriting unchanged rows or constructing an
  // unbounded SQL IN clause (workspaces can have hundreds of automations).
  const wanted = new Set(desired.map(row => JSON.stringify(keys.map(key => row[key]))));
  const remove = db.prepare(`DELETE FROM ${table} WHERE ${keys.map(key => `${key}=?`).join(' AND ')}`);
  for (const row of db.prepare(`SELECT ${keys.join(',')} FROM ${table} ${where}`).all(...args)) {
    if (!wanted.has(JSON.stringify(keys.map(key => row[key])))) remove.run(...keys.map(key => row[key]));
  }
}
