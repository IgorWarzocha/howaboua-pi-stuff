import { View, div } from "gpui-kit";
import { v_flex, h_flex, Button, InputState, Input } from "gpui-base";
import { theme, machines, panes, terminals, run } from "herdr";
import { request, parseStatus, parseDevices, parsePreparation } from "./companion.js";

const PROVIDERS = { grok: "Grok", gippity: "OpenAI" };
const BACKENDS = { grok: "Grok", gippity: "OpenAI · GipPity", codex: "OpenAI · PCC" };

export default class Voice extends View {
  init(_props, cx) {
    this.status = null;
    this.devices = { microphones: [], speakers: [] };
    this.pending = null;
    this.refreshing = false;
    this.revision = 0;
    this.openDevices = null;
    this.advanced = false;
    this.machine = null;
    this.terminal = null;
    this.target = null;
    this.openTarget = null;
    this.statusError = null;
    this.deviceError = null;
    this.actionError = null;
    this.storageError = null;
    let saved = {};
    try {
      const raw = localStorage.getItem("connection");
      if (raw) {
        saved = JSON.parse(raw);
        if (!saved || typeof saved !== "object") throw new Error("Invalid form");
      }
    } catch (_) {
      saved = {};
      this.storageError = "Saved connection could not be read. Enter it again.";
    }
    this.form = {
      provider: Object.hasOwn(PROVIDERS, saved.provider) ? saved.provider : "grok",
      microphone: typeof saved.microphone === "string" ? saved.microphone : "",
      speaker: typeof saved.speaker === "string" ? saved.speaker : "",
    };
    this.inputs = {};
    for (const key of ["url", "sshHost", "certificate"]) {
      const state = InputState.new({ value: typeof saved[key] === "string" ? saved[key] : "" });
      state.on("change", (_e, cx) => { this.save(); cx.notify(); });
      this.inputs[key] = state;
    }
    this.refresh(cx, true);
    cx.timer.every(3000, (cx) => this.refresh(cx));
  }

  save() {
    try {
      const values = { ...this.form };
      for (const key of Object.keys(this.inputs)) values[key] = this.inputs[key].value();
      localStorage.setItem("connection", JSON.stringify(values));
      this.storageError = null;
    } catch (_) { this.storageError = "Connection could not be saved. Check the Herdr app home's permissions."; }
  }

  refresh(cx, devices = false) {
    if (this.pending || this.refreshing) return;
    this.refreshing = true;
    const revision = this.revision;
    cx.spawn(async (cx) => {
      const before = JSON.stringify([this.status, this.statusError, this.devices, this.deviceError]);
      try {
        const status = parseStatus(await request("/status"));
        if (revision === this.revision) {
          this.status = status;
          this.statusError = null;
        }
      } catch (e) {
        if (revision === this.revision) {
          this.status = null;
          this.statusError = e.message;
        }
      }
      if (devices || (this.status && this.deviceError)) {
        try {
          this.devices = parseDevices(await request("/devices"));
          this.deviceError = null;
        } catch (e) { this.deviceError = e.message; }
      }
      this.refreshing = false;
      if (devices || before !== JSON.stringify([this.status, this.statusError, this.devices, this.deviceError])) cx.notify();
    });
  }

  act(path, body, cx) {
    if (this.pending) return;
    // An older poll must not overwrite the result of a user action.
    this.revision++;
    this.pending = path;
    this.actionError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.status = parseStatus(await request(path, body));
        this.statusError = null;
      } catch (e) { this.actionError = e.message; }
      this.pending = null;
      cx.notify();
    });
  }

  connect(cx) {
    const body = { provider: this.form.provider, url: this.inputs.url.value().trim() };
    if (!/^https:\/\/[^\s/]+/.test(body.url)) {
      this.actionError = "Enter the voice server's HTTPS URL.";
      cx.notify();
      return;
    }
    for (const key of ["sshHost", "certificate"]) {
      const value = this.inputs[key].value().trim();
      if (value) body[key] = value;
    }
    for (const key of ["microphone", "speaker"]) if (this.form[key]) body[key] = this.form[key];
    this.save();
    this.target = null;
    this.act("/connect", body, cx);
  }

  prepare(cx, terminal = null) {
    if (this.pending) return;
    const provider = this.form.provider;
    const body = { provider };
    if (terminal) body.terminal = terminal;
    else if (this.machine) body.machine = this.machine;
    const sshHost = this.inputs.sshHost.value().trim();
    if (sshHost) body.sshHost = sshHost;
    const audio = {};
    for (const key of ["microphone", "speaker"]) if (this.form[key]) audio[key] = this.form[key];
    this.save();
    this.revision++;
    this.pending = "/prepare";
    this.actionError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // The companion returns only after the intended Pi has acknowledged voice readiness.
        const prepared = parsePreparation(await request("/prepare", body), provider);
        this.target = prepared.terminal;
        if (!terminal) run("terminal.keep", { terminal: prepared.terminal });
        this.pending = "/connect";
        cx.notify();
        this.status = parseStatus(await request("/connect", { ...prepared.connect, ...audio }));
        this.statusError = null;
      } catch (e) {
        let message = e.message;
        if (this.pending === "/prepare" && e.terminal) {
          this.target = e.terminal;
          try { run("terminal.keep", { terminal: e.terminal }); }
          catch (showError) { message += " Could not show Pi: " + showError.message; }
        }
        this.actionError = message;
      }
      this.pending = null;
      cx.notify();
    });
  }

  paneChoices() {
    const live = new Set(terminals().filter((t) => t.state === "live").map((t) => t.address));
    return panes().filter((p) => p.terminal && live.has(p.terminal));
  }

  launchChoices(disabled) {
    const t = theme();
    const choices = this.paneChoices();
    const selected = choices.find((p) => p.terminal === this.terminal);
    const machineList = machines();
    const machineReady = machineList.some((m) => m.name === this.machine && m.layout === "ready");
    return v_flex().w_full().gap(8)
      .child(this.button("choose-machine", this.machine || "This computer", (_e, cx) => {
        this.openTarget = this.openTarget === "machine" ? null : "machine";
        cx.notify();
      }, disabled))
      .when(this.openTarget === "machine", (el) => el.child(v_flex().id("machine-options").max_h(140)
        .overflow_y_scrollbar().gap(3).children(machineList.map((m, i) =>
          this.button("machine-" + i, (m.name || "This computer") + (m.layout === "ready" ? "" : " (" + m.layout + ")"), (_e, cx) => {
            this.machine = m.name;
            this.openTarget = null;
            cx.notify();
          }, disabled || m.layout !== "ready", this.machine === m.name)))))
      .child(this.button("quickstart", this.pending === "/prepare" ? "Preparing Pi…" : "Quickstart Pi + voice",
        (_e, cx) => this.prepare(cx), disabled || !machineReady, true))
      .child(this.button("choose-pane", selected ? (selected.title || "Pi") + " · " + selected.terminal : "Choose existing pane…", (_e, cx) => {
        this.openTarget = this.openTarget === "pane" ? null : "pane";
        cx.notify();
      }, disabled))
      .when(this.openTarget === "pane", (el) => el.child(v_flex().id("pane-options").max_h(180)
        .overflow_y_scrollbar().gap(3)
        .when(!choices.length, (list) => list.child(div().text_color(t.muted).child("No live terminal panes.")))
        .children(choices.map((p) => this.button("pane-" + p.pane, (p.title || "Terminal") + " · " + p.terminal, (_e, cx) => {
          this.terminal = p.terminal;
          this.openTarget = null;
          cx.notify();
        }, disabled, this.terminal === p.terminal)))))
      .child(this.button("start-pane", "Start voice in selected pane", (_e, cx) => this.prepare(cx, this.terminal),
        disabled || !selected));
  }

  button(id, label, action, disabled = false, selected = false) {
    const t = theme();
    return Button.new(id).accessibility_label(label).disabled(disabled)
      .px(10).py(7).rounded(5).border_1().border_color(selected ? t.accent : t.border)
      .bg(selected ? t.selected : t.raised).text_color(disabled ? t.dim : t.foreground)
      .on_click(action).child(label);
  }

  field(key, label) {
    const t = theme();
    return v_flex().gap(4).w_full()
      .child(div().text_color(t.muted).child(label))
      .child(Input.new(this.inputs[key]).accessibility_label(label).w_full().h(34).px(8)
        .rounded(5).border_1().border_color(t.input).bg(t.background).text_color(t.foreground));
  }

  deviceChoice(key, label, devices, disabled) {
    const t = theme();
    const selected = this.form[key];
    const found = devices.find((d) => d.name === selected);
    const name = selected ? (found?.description || selected) : "System default";
    const options = [{ name: "", description: "System default" }, ...devices];
    if (selected && !found) options.push({ name: selected, description: selected + " (unavailable)" });
    return v_flex().w_full().gap(4)
      .child(div().text_color(t.muted).child(label))
      .child(this.button("choose-" + key, name, (_e, cx) => {
        this.openDevices = this.openDevices === key ? null : key;
        cx.notify();
      }, disabled))
      .when(this.openDevices === key, (el) => el.child(v_flex().id(key + "-options").max_h(180)
        .overflow_y_scrollbar().gap(3).children(options.map((d, i) =>
          this.button(key + "-" + i, d.description || d.name, (_e, cx) => {
            this.form[key] = d.name;
            this.openDevices = null;
            this.save();
            cx.notify();
          }, disabled, selected === d.name)))));
  }

  render() {
    const t = theme();
    const status = this.status;
    const active = status && ["connecting", "listening", "muted"].includes(status.phase);
    const busy = this.pending !== null;
    const phase = this.pending === "/prepare" ? "Preparing Pi…" : this.pending === "/connect" ? "Connecting…" : this.statusError ? "Unavailable" : status ? {
      idle: "Idle", connecting: "Connecting…", listening: "Listening", muted: "Muted", error: "Error",
    }[status.phase] : "Checking…";
    const errors = [...new Set([this.statusError, status?.error, this.actionError, this.deviceError, this.storageError].filter(Boolean))];
    return v_flex().id("voice").size_full().min_w(0).bg(t.surface).text_color(t.foreground).text_size(13)
      .child(h_flex().px(12).py(10).justify_between().items_center()
        .child(div().font_semibold().text_size(15).child("Voice"))
        .child(div().text_color(this.statusError || status?.phase === "error" ? t.blocked : t.muted).child(phase)))
      .child(v_flex().id("voice-form").flex_1().min_h(0).overflow_y_scrollbar().px(12).pb(12).gap(10)
        .when(Boolean(status?.provider), (el) => el.child(v_flex().gap(3)
          .child(div().child(status.provider === "gippity" && !this.target ? "OpenAI" : BACKENDS[status.provider]))
          .child(div().text_color(t.muted).child(status.url || ""))))
        .when(Boolean(this.target), (el) => el.child(div().text_color(t.muted).child("Pi · " + this.target)))
        .child(h_flex().gap(6).children(Object.keys(PROVIDERS).map((provider) =>
          this.button("provider-" + provider, PROVIDERS[provider], (_e, cx) => {
            this.form.provider = provider;
            this.save();
            cx.notify();
          }, busy || active, this.form.provider === provider))))
        .child(this.launchChoices(busy || active || !status))
        .child(this.button("advanced", this.advanced ? "Hide connection options" : "Connection options / manual URL", (_e, cx) => {
          this.advanced = !this.advanced;
          cx.notify();
        }))
        .when(this.advanced, (el) => el
          .child(this.field("sshHost", "SSH host (optional)"))
          .child(this.field("url", "Manual server HTTPS URL"))
          .child(this.field("certificate", "Certificate PEM path (optional)"))
          .child(this.button("connect", busy && this.pending === "/connect" ? "Connecting…" : "Connect manually",
            (_e, cx) => this.connect(cx), busy || active || !status)))
        .child(this.deviceChoice("microphone", "Microphone", this.devices.microphones, busy || active))
        .child(this.deviceChoice("speaker", "Speaker", this.devices.speakers, busy || active))
        .child(this.button("refresh-devices", "Refresh devices", (_e, cx) => this.refresh(cx, true), busy || this.refreshing))
        .children(errors.map((message) => div().text_color(t.blocked).child(message)))
        .child(h_flex().gap(6)
          .child(this.button("disconnect", "Disconnect", (_e, cx) => this.act("/disconnect", {}, cx),
            busy || !status || status.phase === "idle")))
        .child(this.button("mute", status?.muted ? "Unmute" : "Mute",
          (_e, cx) => this.act("/mute", { muted: !this.status.muted }, cx),
          busy || !status || !["listening", "muted"].includes(status.phase))));
  }
}
