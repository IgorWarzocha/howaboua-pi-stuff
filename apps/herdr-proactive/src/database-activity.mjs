import { emptyActivity } from './activity.mjs';
import { fields, scalar, upsert, pruneRows } from './database-rows.mjs';

export const activitySchema = `
CREATE TABLE activity_state (id INTEGER PRIMARY KEY CHECK(id=1),lastEngagementAt REAL,observedThrough REAL,asOf REAL);
CREATE TABLE activity_bucket (resolution TEXT NOT NULL CHECK(resolution IN('day','month')),bucket INTEGER NOT NULL,engagements INTEGER NOT NULL CHECK(engagements>=0),observedMs REAL NOT NULL CHECK(observedMs>=0),PRIMARY KEY(resolution,bucket));
CREATE TABLE activity_hour (resolution TEXT NOT NULL,bucket INTEGER NOT NULL,hour INTEGER NOT NULL CHECK(hour BETWEEN 0 AND 23),engagements INTEGER NOT NULL CHECK(engagements>=0),observedMs REAL NOT NULL CHECK(observedMs>=0),PRIMARY KEY(resolution,bucket,hour),FOREIGN KEY(resolution,bucket) REFERENCES activity_bucket(resolution,bucket) ON DELETE CASCADE);`;

function counter(value, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) throw new TypeError('Invalid activity counter');
  return value;
}

function timestamp(value) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 8.64e15) throw new TypeError('Invalid activity timestamp');
  return value;
}

function activityRows(activity) {
  fields(activity, ['days', 'months', 'lastEngagementAt', 'observedThrough', 'asOf']);
  const state = { id: 1, lastEngagementAt: timestamp(activity.lastEngagementAt), observedThrough: timestamp(activity.observedThrough), asOf: timestamp(activity.asOf) };
  const buckets = [], hours = [];
  const date = activity.asOf === null ? null : new Date(activity.asOf);
  const today = date === null ? null : Math.floor(activity.asOf / 86400000) * 86400000;
  const month = date === null ? null : date.getUTCFullYear() * 12 + date.getUTCMonth();
  for (const [resolution, records, key, current, span] of [
    ['day', activity.days, 'day', today, 34 * 86400000],
    ['month', activity.months, 'month', month, 12],
  ]) {
    if (!Array.isArray(records)) throw new TypeError('Expected activity bucket list');
    const seen = new Set();
    for (const record of records) {
      fields(record, [key, 'engagements', 'observedMs', 'hourlyEngagements', 'hourlyObservedMs']);
      const bucket = scalar(record[key], 'integer');
      if (bucket === null || (resolution === 'day' && bucket % 86400000 !== 0) || seen.has(bucket)) throw new TypeError('Invalid or duplicate activity bucket');
      seen.add(bucket);
      const engagements = counter(record.engagements, true), observedMs = counter(record.observedMs);
      if (!Array.isArray(record.hourlyEngagements) || record.hourlyEngagements.length !== 24 || !Array.isArray(record.hourlyObservedMs) || record.hourlyObservedMs.length !== 24) throw new TypeError('Expected 24 activity hours');
      const hourRows = Array.from({ length: 24 }, (_, hour) => ({ resolution, bucket, hour,
        engagements: counter(record.hourlyEngagements[hour], true), observedMs: counter(record.hourlyObservedMs[hour]) }));
      if (current === null) throw new TypeError('Activity buckets require an asOf timestamp');
      if (bucket < current - span || bucket > current) continue;
      buckets.push({ resolution, bucket, engagements, observedMs });
      hours.push(...hourRows);
    }
  }
  return { state, buckets, hours };
}

export function activityStore(db, transaction) {
  return {
    readActivity: () => transaction(() => {
      const activity = emptyActivity();
      const state = db.prepare('SELECT lastEngagementAt,observedThrough,asOf FROM activity_state WHERE id=1').get();
      if (state) Object.assign(activity, state);
      const records = new Map();
      for (const row of db.prepare('SELECT * FROM activity_bucket ORDER BY resolution,bucket').all()) {
        const record = { [row.resolution]: row.bucket, engagements: row.engagements, observedMs: row.observedMs,
          hourlyEngagements: Array(24).fill(0), hourlyObservedMs: Array(24).fill(0) };
        activity[row.resolution === 'day' ? 'days' : 'months'].push(record);
        records.set(`${row.resolution}:${row.bucket}`, record);
      }
      for (const row of db.prepare('SELECT * FROM activity_hour ORDER BY resolution,bucket,hour').all()) {
        const record = records.get(`${row.resolution}:${row.bucket}`);
        record.hourlyEngagements[row.hour] = row.engagements;
        record.hourlyObservedMs[row.hour] = row.observedMs;
      }
      return activity;
    }, false),
    writeActivity: activity => transaction(() => {
      const { state, buckets, hours } = activityRows(activity);
      upsert(db, 'activity_state', ['id'], state);
      for (const row of buckets) upsert(db, 'activity_bucket', ['resolution', 'bucket'], row);
      for (const row of hours) upsert(db, 'activity_hour', ['resolution', 'bucket', 'hour'], row);
      pruneRows(db, 'activity_bucket', ['resolution', 'bucket'], buckets);
    }),
  };
}
