import { exec, focused, spaces } from "herdr";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = value => typeof value === "number" && Number.isFinite(value);
const time = value => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const nullableTime = value => value === null || finite(value);
const fileVersion = value => typeof value.path === "string" && value.path.startsWith("/") && typeof value.revision === "string";

function jobValid(job) {
  if (!object(job) || typeof job.id !== "string" || typeof job.name !== "string" ||
      typeof job.enabled !== "boolean" || typeof job.prompt !== "string" || !object(job.schedule) ||
      !fileVersion(job) || !finite(job.createdAt)) return false;
  const s = job.schedule;
  if (s.kind === "interval") return finite(s.minutes) && s.minutes > 0 && (s.anchor === undefined || finite(s.anchor));
  if (s.kind === "once") return finite(s.at);
  if (s.kind === "daily") return time(s.time);
  return s.kind === "weekly" && time(s.time) && Array.isArray(s.days) && s.days.length > 0 &&
    s.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6);
}

export function policyValid(p) {
  return object(p) && ["id", "name", "space", "terminal", "prompt"].every(key => typeof p[key] === "string") &&
    typeof p.enabled === "boolean" && typeof p.allowTerminalInput === "boolean" &&
    ["adaptive", "fixed", "off"].includes(p.mode) && finite(p.minMinutes) && p.minMinutes > 0 &&
    [p.quietStart, p.quietEnd].every(hour => Number.isInteger(hour) && hour >= 0 && hour < 24) &&
    (p.scope === undefined || ["workspace", "thread"].includes(p.scope)) && fileVersion(p) && Array.isArray(p.jobs) && p.jobs.every(jobValid);
}

export function parseStatus(data) {
  if (!object(data) || !object(data.service) || typeof data.service.running !== "boolean" ||
      !nullableTime(data.service.observedAt) || !(data.service.error === null || typeof data.service.error === "string") ||
      !Array.isArray(data.policies) || !data.policies.every(policyValid) ||
      !Array.isArray(data.workspaces) || !data.workspaces.every(w => object(w) && typeof w.id === "string" && typeof w.name === "string" &&
        (w.root === null || (typeof w.root === "string" && w.root.startsWith("/")))) ||
      !Array.isArray(data.errors) || !data.errors.every(e => object(e) && (e.space === null || typeof e.space === "string") &&
        typeof e.path === "string" && typeof e.message === "string") ||
      !Array.isArray(data.terminals) || !data.terminals.every(t => object(t) && typeof t.address === "string" &&
        typeof t.name === "string" && (t.space === null || typeof t.space === "string") && (t.status === null || typeof t.status === "string")) ||
      !object(data.runtime) || !object(data.activity)) {
    throw new Error("Invalid proactive status. Update herdr-proactive on the selected machine, then Refresh.");
  }
  return data;
}

export async function command(machine, action, payload) {
  let result;
  try { result = await exec("herdr-proactive", payload === undefined ? [action] : [action, JSON.stringify(payload)], { on: machine }); }
  catch (error) { throw new Error("Could not reach Proactive on " + (machine || "this computer") + ". " + error.message); }
  let data;
  try { data = JSON.parse(result.stdout); }
  catch (_) { throw new Error("Could not load check-ins. " + (result.stderr.trim() || "Check that Proactive is installed on the selected machine.")); }
  if (result.code !== 0 || data?.error) {
    const message = data?.error?.message || (typeof data?.error === "string" ? data.error : "") || result.stderr.trim() || "Proactive action failed.";
    const error = new Error(message.replace(/\bpolicies\b/gi, "check-ins").replace(/\bpolicy\b/gi, "check-in").replace(/\brecipient terminal\b/gi, "agent"));
    error.kind = data?.error?.kind;
    throw error;
  }
  if (!object(data)) throw new Error("herdr-proactive returned an invalid response. Refresh to reload status.");
  return data;
}

export function localId(id, machine) {
  const prefix = machine ? machine + "/" : "";
  return prefix && id?.startsWith(prefix) ? id.slice(prefix.length) : id;
}

export function focusTarget() {
  const f = focused();
  const machine = spaces().find(s => s.id === f?.space)?.machine ??
    (f?.terminal?.includes("/") ? f.terminal.slice(0, f.terminal.indexOf("/")) : null);
  return { machine, space: localId(f?.space, machine) ?? "", terminal: localId(f?.terminal, machine) ?? "" };
}

export function newId() { return "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10); }
export function dateLabel(value) { return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value).toLocaleString() : "Not yet"; }
export function durationLabel(minutes) {
  const [amount, unit] = minutes % 1440 === 0 ? [minutes / 1440, "day"] : minutes % 60 === 0 ? [minutes / 60, "hour"] : [minutes, "minute"];
  return amount + " " + unit + (amount === 1 ? "" : "s");
}
export function scheduleLabel(s) {
  if (s.kind === "interval") return "Every " + durationLabel(s.minutes);
  if (s.kind === "once") return dateLabel(s.at);
  if (s.kind === "daily") return "Every day at " + s.time + " UTC";
  return s.days.map(d => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ") + " at " + s.time + " UTC";
}
