import { shared, setShared, focused, spaces, panes, terminals, machines, notify } from "herdr";

export const PROVIDERS = { grok: "Grok", gippity: "OpenAI" };
const strings = ["microphone", "speaker", "sshHost", "url", "certificate", "terminal"];

export function connection(legacy = null) {
  const saved = shared("voice.connection") ?? legacy ?? {};
  const value = { provider: Object.hasOwn(PROVIDERS, saved.provider) ? saved.provider : "grok" };
  for (const key of strings) value[key] = typeof saved[key] === "string" ? saved[key] : "";
  if (saved.machine === null || typeof saved.machine === "string") value.machine = saved.machine;
  return value;
}

export function saveConnection(value) {
  if (JSON.stringify(shared("voice.connection")) !== JSON.stringify(value)) setShared("voice.connection", value);
}

export function migrateConnection(legacy) {
  if (shared("voice.connection") == null && legacy && typeof legacy === "object") saveConnection(connection(legacy));
}

export function updateConnection(key, value) {
  const current = connection();
  if (key === "machine" && value === undefined) delete current.machine;
  else current[key] = value;
  saveConnection(current);
}

export function terminalMachine(address) {
  return address?.includes("/") ? address.slice(0, address.indexOf("/")) : null;
}

export function piPanes(machine) {
  const live = new Set(terminals().filter(t => t.state === "live").map(t => t.address));
  return panes().filter(p => p.terminal && live.has(p.terminal) &&
    (machine === undefined || terminalMachine(p.terminal) === machine) &&
    (p.app === "pi" || p.program?.key === "pi"));
}

export function targets() {
  const focus = focused();
  const focusedMachine = focus?.terminal
    ? terminalMachine(focus.terminal)
    : spaces().find(s => s.id === focus?.space)?.machine ?? null;
  const machine = focusedMachine;
  const terminal = focus?.terminal;
  const live = terminals().find(t => t.address === terminal && t.state === "live" &&
    terminalMachine(t.address) === machine &&
    (t.program?.key === "pi" || t.report?.app === "pi" || t.labels?.["herdr.voice"] === "1"));
  const pane = piPanes(machine).find(p => p.terminal === terminal);
  return {
    terminal: pane?.terminal ?? live?.address ?? null,
    machine,
    machineReady: machines().some(m => m.name === machine && m.layout === "ready"),
  };
}

export function publishStatus(status, statusError = null) {
  if (statusError !== shared("voice.statusError")) {
    setShared("voice.statusError", statusError);
    if (statusError) notify({ title: "Voice unavailable", body: statusError, level: "warning" });
  }
  if (status) {
    const previous = shared("voice.observedFailure");
    const failure = status.error;
    const key = failure ? failure.id || JSON.stringify(failure.details) : null;
    // The first successful snapshot is a baseline, not evidence of a new failure.
    // Shared observation prevents polling, other views and reopen from repeating it.
    if (previous?.key !== key || !previous) {
      setShared("voice.observedFailure", { key });
      if (previous && key && failureNotice(status)) notify({ title: "Voice ended", level: "warning",
        body: failure.message + " Open Voice settings for details." });
    }
  }
  const target = shared("voice.target");
  if (status?.phase === "idle" && target) setShared("voice.target", null);
  const active = status && ["connecting", "listening", "muted"].includes(status.phase);
  const activity = active && target?.url === status.url ? {
    terminal: target.terminal, phase: status.phase, muted: status.muted,
  } : null;
  if (JSON.stringify(shared("voice.activity")) !== JSON.stringify(activity))
    setShared("voice.activity", activity);
}

export function setTarget(terminal, url) {
  setShared("voice.target", terminal ? { terminal, url } : null);
}

// Legacy companions have no event ID or occurrence time. Never invent either.
export function failureNotice(status) {
  const error = status?.error;
  if (!error || (!error.id && shared("voice.acknowledgedLegacyError") === JSON.stringify(error.details))) return null;
  return error;
}

export function acknowledgeLegacyFailure(error) {
  setShared("voice.acknowledgedLegacyError", JSON.stringify(error.details));
}
