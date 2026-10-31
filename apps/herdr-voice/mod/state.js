import { shared, setShared, focused, spaces, panes, terminals, machines } from "herdr";

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

export function piPanes() {
  const live = new Set(terminals().filter(t => t.state === "live").map(t => t.address));
  return panes().filter(p => p.terminal && live.has(p.terminal) &&
    (p.app === "pi" || p.program?.key === "pi"));
}

export function targets(settings) {
  const focus = focused();
  const terminal = settings.terminal || focus?.terminal;
  const live = terminals().find(t => t.address === terminal && t.state === "live" &&
    (t.program?.key === "pi" || t.report?.app === "pi" || t.labels?.["herdr.voice"] === "1"));
  const pane = piPanes().find(p => p.terminal === terminal);
  const focusedMachine = spaces().find(s => s.id === focus?.space)?.machine ?? null;
  const machine = Object.hasOwn(settings, "machine") ? settings.machine : focusedMachine;
  return {
    terminal: pane?.terminal ?? live?.address ?? null,
    machine,
    machineReady: machines().some(m => m.name === machine && m.layout === "ready"),
  };
}

export function publishStatus(status) {
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
