import { activitySummary } from './activity.mjs';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const validTime = value => Number.isFinite(value) && Math.abs(value) <= 8.64e15;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function outsideQuiet(at, start, end) {
  if (start === end) return at;
  const date = new Date(at);
  const hour = date.getUTCHours();
  const quiet = start < end ? hour >= start && hour < end : hour >= start || hour < end;
  if (!quiet) return at;
  if (start > end && hour >= start) date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(end, 0, 0, 0);
  return date.getTime();
}

function adaptiveDelay(summary, minimum) {
  // Only compare rates when both windows contain meaningful observed time.
  const recent = summary.weekly.observedHours >= 4 ? summary.weekly : summary.monthly;
  if (recent.observedHours < 4 || summary.past.observedHours < 8 || !(summary.past.rate > 0)) {
    return { delay: minimum, reason: 'adaptive-learning' };
  }
  const ratio = recent.rate / summary.past.rate;
  // A decline opens an earlier opportunity; sustained high engagement leaves room.
  const factor = clamp(0.5 + ratio, 1, 3);
  return { delay: minimum * factor, reason: ratio < 0.75 ? 'adaptive-decline' : ratio > 1.25 ? 'adaptive-active' : 'adaptive-baseline' };
}

function preferredHour(at, hourly, start, end) {
  let best = outsideQuiet(at, start, end);
  let score = hourly[new Date(best).getUTCHours()];
  // At most six hours of optional delay. A later slot must earn its waiting cost.
  for (let offset = 1; offset <= 6; offset++) {
    const slot = outsideQuiet((Math.floor(at / HOUR) + offset) * HOUR, start, end);
    const wait = slot - at;
    if (wait > 6 * HOUR) continue;
    const candidate = hourly[new Date(slot).getUTCHours()] - wait / (12 * HOUR);
    if (candidate > score) { best = slot; score = candidate; }
  }
  return best;
}

// Deterministic absolute deadlines: rechecking an overdue deadline returns now,
// never a past timestamp. Disabled and pending work wait for a state-change event.
export function nextGeneric(policy, runtime, activity, nowMs) {
  if (!validTime(nowMs)) throw new RangeError('Invalid scheduling timestamp');
  if (policy.mode === 'off') return { at: null, reason: 'off' };
  if (runtime.pendingUnseen) return { at: null, reason: 'pending-unseen' };
  const minutes = policy.minMinutes ?? 240;
  const start = policy.quietStart ?? 22, end = policy.quietEnd ?? 8;
  if (!['fixed', 'adaptive'].includes(policy.mode) || !Number.isFinite(minutes) || minutes <= 0
      || !Number.isInteger(start) || start < 0 || start > 23 || !Number.isInteger(end) || end < 0 || end > 23) {
    throw new RangeError('Invalid generic scheduling policy');
  }
  const minimum = minutes * MINUTE;
  const anchors = [runtime.lastGenericAt, runtime.enabledAt].filter(validTime);
  const anchor = anchors.length ? Math.max(...anchors) : nowMs - minimum;
  let at = anchor + minimum;
  let reason = 'fixed';
  if (policy.mode === 'adaptive') {
    const summary = activitySummary(activity, nowMs);
    const adaptive = adaptiveDelay(summary, minimum);
    at = anchor + adaptive.delay;
    reason = adaptive.reason;
    if (validTime(runtime.lastEngagementAt)) at = Math.max(at, runtime.lastEngagementAt + minimum);
    at = preferredHour(at, summary.hourly, start, end);
  }
  if (validTime(runtime.snoozedUntil) && runtime.snoozedUntil > at && runtime.snoozedUntil > nowMs) {
    at = runtime.snoozedUntil;
    reason = 'snoozed';
  }
  at = Math.max(at, nowMs);
  const allowed = outsideQuiet(at, start, end);
  if (allowed !== at) reason = 'quiet-hours';
  return { at: allowed, reason };
}

// All wall-clock jobs use UTC. Invalid schedules and exhausted one-shots return
// null; successful results are strictly after afterMs, including exact boundaries.
export function nextJob(job, afterMs) {
  if (!validTime(afterMs)) return null;
  const schedule = job?.schedule;
  if (!schedule) return null;
  if (schedule.kind === 'once') return validTime(schedule.at) && schedule.at > afterMs ? schedule.at : null;
  if (schedule.kind === 'interval') {
    const period = schedule.minutes * MINUTE;
    if (!Number.isFinite(period) || period < 1 || !validTime(schedule.anchor)) return null;
    const steps = Math.max(0, Math.floor((afterMs - schedule.anchor) / period) + 1);
    const next = schedule.anchor + steps * period;
    return validTime(next) && next > afterMs ? next : null;
  }
  if (!['daily', 'weekly'].includes(schedule.kind) || typeof schedule.time !== 'string'
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) return null;
  if (schedule.kind === 'weekly' && (!Array.isArray(schedule.days) || !schedule.days.length
      || !schedule.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6))) return null;
  const [hour, minute] = schedule.time.split(':').map(Number);
  const date = new Date(afterMs);
  date.setUTCHours(hour, minute, 0, 0);
  for (let offset = 0; offset <= 7; offset++) {
    const at = date.getTime() + offset * DAY;
    if (at > afterMs && validTime(at) && (schedule.kind === 'daily' || schedule.days.includes(new Date(at).getUTCDay()))) return at;
  }
  return null;
}
