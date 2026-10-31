import { View } from "gpui-kit";
import { InputState } from "gpui-base";
import { props, run } from "herdr";
import { request, parseStatus, parseDevices, parsePreparation } from "./companion.js";
import { connection, migrateConnection, updateConnection, targets, publishStatus, setTarget } from "./state.js";
import { Choice } from "./select.js";
import { renderSidebar } from "./sidebar.js";
import { renderSettings } from "./settings.js";

export default class Voice extends View {
  init(_props, cx) {
    const options = props() ?? {};
    this.compact = options.compact === true;
    this.overlay = options.overlay;
    this.toolbar = options.toolbar === true;
    this.status = null;
    this.devices = { microphones: [], speakers: [] };
    this.pending = null;
    this.refreshing = false;
    this.revision = 0;
    this.advanced = false;
    this.statusError = this.deviceError = this.actionError = this.storageError = null;
    let legacy;
    try { legacy = JSON.parse(localStorage.getItem("connection") || "null"); }
    catch (_) { this.storageError = "Saved connection could not be read. Choose it again."; }
    migrateConnection(legacy);
    const saved = connection();
    this.inputs = {};
    for (const key of ["url", "sshHost", "certificate"]) {
      const state = InputState.new({ value: saved[key] });
      state.on("change", (_e, cx) => { this.save(key, state.value()); cx.notify(); });
      this.inputs[key] = state;
    }
    this.choices = {};
    if (!this.compact) for (const [key, label] of Object.entries({
      provider: "Provider", machine: "Quick connect machine", terminal: "Connect to", microphone: "Microphone", speaker: "Speaker", advanced: "Connection",
    })) this.choices[key] = new Choice("voice-" + key, label, cx);
    this.refresh(cx, !this.compact);
    cx.timer.every(3000, cx => this.refresh(cx));
  }

  save(key, value) {
    try {
      updateConnection(key, value);
      this.storageError = null;
    } catch (_) { this.storageError = "Voice settings could not be saved. Check the Herdr app home's permissions."; }
  }

  refresh(cx, devices = false) {
    if (this.pending || this.refreshing) return;
    const saved = connection();
    for (const [key, state] of Object.entries(this.inputs)) if (state.value() !== saved[key]) state.set_value(saved[key]);
    this.refreshing = true;
    const revision = this.revision;
    cx.spawn(async cx => {
      const before = JSON.stringify([this.status, this.statusError, this.devices, this.deviceError]);
      try {
        const status = parseStatus(await request("/status"));
        if (revision === this.revision) { this.status = status; this.statusError = null; publishStatus(status); }
      } catch (e) {
        if (revision === this.revision) { this.status = null; this.statusError = e.message; publishStatus(null); }
      }
      if (!this.compact && (devices || (this.status && this.deviceError))) {
        try { this.devices = parseDevices(await request("/devices")); this.deviceError = null; }
        catch (e) { this.deviceError = e.message; }
      }
      this.refreshing = false;
      if (devices || before !== JSON.stringify([this.status, this.statusError, this.devices, this.deviceError])) cx.notify();
    });
  }

  act(path, body, cx) {
    if (this.pending) return;
    this.revision++;
    this.pending = path;
    this.actionError = null;
    cx.notify();
    cx.spawn(async cx => {
      try { this.status = parseStatus(await request(path, body)); this.statusError = null; publishStatus(this.status); }
      catch (e) { this.actionError = e.message; }
      this.pending = null;
      cx.notify();
    });
  }

  connect(cx) {
    const saved = connection();
    const body = { provider: saved.provider, url: saved.url.trim() };
    if (!/^https:\/\/[^\s/]+/.test(body.url)) {
      this.actionError = "Enter the voice server's HTTPS URL."; cx.notify(); return;
    }
    for (const key of ["sshHost", "certificate", "microphone", "speaker"]) if (saved[key]) body[key] = saved[key];
    setTarget(null);
    this.act("/connect", body, cx);
  }

  start(cx, quick) {
    if (this.pending) return;
    const saved = connection();
    const target = targets(saved);
    if (quick ? !target.machineReady : !target.terminal) {
      this.actionError = quick ? "The selected machine is unavailable." : "Focus a live Pi pane, then connect voice.";
      cx.notify(); return;
    }
    const body = { provider: saved.provider };
    if (quick && target.machine) body.machine = target.machine;
    if (!quick) body.terminal = target.terminal;
    if (saved.sshHost) body.sshHost = saved.sshHost;
    this.revision++;
    this.pending = "/prepare";
    this.actionError = null;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const prepared = parsePreparation(await request("/prepare", body), saved.provider);
        if (quick) run("terminal.keep", { terminal: prepared.terminal });
        this.pending = "/connect";
        cx.notify();
        const audio = {};
        for (const key of ["microphone", "speaker"]) if (saved[key]) audio[key] = saved[key];
        this.status = parseStatus(await request("/connect", { ...prepared.connect, ...audio }));
        setTarget(prepared.terminal, prepared.connect.url);
        publishStatus(this.status);
        this.statusError = null;
      } catch (e) {
        let message = e.message;
        if (this.pending === "/prepare" && e.terminal) {
          try { run("terminal.keep", { terminal: e.terminal }); }
          catch (showError) { message += " Could not show Pi: " + showError.message; }
        }
        this.actionError = message;
      }
      this.pending = null;
      cx.notify();
    });
  }

  render() {
    const phase = this.pending === "/prepare" ? "Preparing Pi" : this.pending === "/connect" ? "Connecting" : this.statusError ? "Unavailable" : this.status ? {
      idle: "Idle", connecting: "Connecting", listening: "Listening", muted: "Muted", error: "Error",
    }[this.status.phase] : "Checking";
    return this.compact ? renderSidebar({
      status: this.status, phase, busy: Boolean(this.pending), target: targets(connection()), expanded: this.toolbar,
      error: this.statusError || this.actionError || this.status?.error,
      onQuick: cx => this.start(cx, true), onConnect: cx => this.start(cx, false),
      onMute: cx => this.act("/mute", { muted: !this.status.muted }, cx),
      onDisconnect: cx => this.act("/disconnect", {}, cx),
    }) : renderSettings(this, phase);
  }
}
