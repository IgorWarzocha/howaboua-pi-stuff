const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const COALESCE = 15 * 60_000;
const zeros = () => Array(24).fill(0);
const dayOf = ms => Math.floor(ms / DAY) * DAY;
const monthOf = ms => {
  const date = new Date(ms);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
};

function checkTime(ms) {
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) throw new RangeError('Invalid activity timestamp');
}

export function emptyActivity() {
  return { days: [], months: [], lastEngagementAt: null, observedThrough: null, asOf: null };
}

function bucket(records, key, value) {
  let record = records.find(item => item[key] === value);
  if (!record) {
    record = { [key]: value, engagements: 0, observedMs: 0, hourlyEngagements: zeros(), hourlyObservedMs: zeros() };
    records.push(record);
  }
  return record;
}

// Months are updated alongside days, never reconstructed from expiring daily data.
export function pruneActivity(activity, nowMs) {
  checkTime(nowMs);
  const asOf = Math.max(nowMs, activity.asOf ?? nowMs);
  activity.asOf = asOf;
  activity.days = activity.days.filter(item => item.day >= dayOf(asOf) - 34 * DAY && item.day <= dayOf(asOf));
  activity.months = activity.months.filter(item => item.month >= monthOf(asOf) - 12 && item.month <= monthOf(asOf));
}

// Supply chronological, verified connected intervals only. A reconnect starts a new
// interval; neither this cursor nor wall-clock elapsed time establishes coverage.
export function observeCoverage(activity, fromMs, toMs) {
  checkTime(fromMs);
  checkTime(toMs);
  if (toMs <= fromMs) return;
  pruneActivity(activity, toMs);
  const date = new Date(activity.asOf);
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCMonth(date.getUTCMonth() - 12);
  let start = Math.max(fromMs, activity.observedThrough ?? fromMs, date.getTime());
  const firstDay = dayOf(activity.asOf) - 34 * DAY;
  while (start < toMs) {
    const end = Math.min(toMs, (Math.floor(start / HOUR) + 1) * HOUR);
    const hour = new Date(start).getUTCHours();
    const records = [bucket(activity.months, 'month', monthOf(start))];
    if (dayOf(start) >= firstDay) records.push(bucket(activity.days, 'day', dayOf(start)));
    for (const record of records) {
      record.observedMs += end - start;
      record.hourlyObservedMs[hour] += end - start;
    }
    start = end;
  }
  activity.observedThrough = Math.max(activity.observedThrough ?? toMs, toMs);
}

export function recordEngagement(activity, nowMs) {
  checkTime(nowMs);
  pruneActivity(activity, nowMs);
  const previous = activity.lastEngagementAt;
  if (previous !== null && nowMs <= previous) return;
  activity.lastEngagementAt = nowMs;
  if (previous !== null && nowMs - previous < COALESCE) return;
  if (monthOf(nowMs) < monthOf(activity.asOf) - 12) return;
  const records = [bucket(activity.months, 'month', monthOf(nowMs))];
  if (dayOf(nowMs) >= dayOf(activity.asOf) - 34 * DAY) records.push(bucket(activity.days, 'day', dayOf(nowMs)));
  for (const record of records) {
    record.engagements++;
    record.hourlyEngagements[new Date(nowMs).getUTCHours()]++;
  }
}

function totals(records) {
  const engagements = records.reduce((sum, item) => sum + item.engagements, 0);
  const observedHours = records.reduce((sum, item) => sum + item.observedMs / HOUR, 0);
  return { engagements, observedHours, rate: observedHours > 0 ? engagements / observedHours : null };
}

// Weekly spans seven UTC dates including today; monthly is the current UTC month.
// No observation means unknown (null rate), not zero activity. Read-only view.
export function activitySummary(activity, nowMs) {
  checkTime(nowMs);
  const today = dayOf(nowMs);
  const month = monthOf(nowMs);
  const recent = days => totals(activity.days.filter(item => item.day >= today - (days - 1) * DAY && item.day <= today));
  const completed = activity.months.filter(item => item.month < month && item.month >= month - 12);
  const past = { ...totals(completed), months: completed.filter(item => item.observedMs > 0).length };
  const weighted = completed.filter(item => item.observedMs > 0).map(item => ({
    ...item,
    engagements: item.engagements * 0.85 ** (month - item.month - 1),
    observedMs: item.observedMs * 0.85 ** (month - item.month - 1),
  }));
  // Keep counts interpretable; only the historical rate is recency-weighted.
  past.rate = totals(weighted).rate;
  const hourEvents = zeros(), hourHours = zeros();
  for (const item of activity.months) {
    if (item.month > month || item.month < month - 12) continue;
    const weight = 0.85 ** (month - item.month);
    for (let hour = 0; hour < 24; hour++) {
      hourEvents[hour] += item.hourlyEngagements[hour] * weight;
      hourHours[hour] += item.hourlyObservedMs[hour] / HOUR * weight;
    }
  }
  const events = hourEvents.reduce((sum, value) => sum + value, 0);
  const hours = hourHours.reduce((sum, value) => sum + value, 0);
  // Two hours of baseline smoothing avoid ranking a barely observed hour first.
  const baseline = hours > 0 ? events / hours : 0;
  const rates = hourHours.map((value, hour) => value > 0 ? (hourEvents[hour] + 2 * baseline) / (value + 2) : baseline);
  const maxRate = Math.max(...rates);
  const hourly = maxRate > 0 ? rates.map(rate => rate / maxRate) : Array(24).fill(0.5);
  return { weekly: recent(7), monthly: totals(activity.months.filter(item => item.month === month)), past, hourly };
}
