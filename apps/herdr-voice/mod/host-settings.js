import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Checkbox } from "gpui-base";
import { theme, machines, shared, setShared } from "herdr";
import { request } from "./companion.js";
import { connection, targets } from "./state.js";
import { Choice } from "./select.js";
import { textButton, icon } from "./ui.js";

const labels = {
  model: "Voice model", realtimeVoice: "Primary voice", realtimeAlternateVoice: "Alternate voice",
  v3Voice: "Primary voice", v3AlternateVoice: "Alternate voice", voice: "Primary voice", alternateVoice: "Alternate voice",
  apiProvider: "Pi API provider", contextModel: "Context summary model", contextReasoning: "Summary reasoning",
  taskDelegationReasoning: "Task reasoning", reasoning: "Voice reasoning", speed: "Speech speed",
  language: "Transcription language", silenceSeconds: "Follow-up after silence (seconds; 0 = off)",
  webSearch: "Web search", autoResume: "Resume dropped calls", autoResumeRealtime: "Resume dropped calls",
  refreshRealtimeAfterCompaction: "Refresh voice after compaction", delegationAcknowledgements: "Acknowledge delegated tasks",
  forwardReasoningSummaries: "Forward reasoning summaries",
};
const textKeys = ["apiProvider", "speed", "language", "silenceSeconds"];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const providers = { codex: "PCC Voice", gippity: "Gippity Voice", grok: "Grok" };
const sameTarget = (a, b) => a && b && a.provider === b.provider && a.machine === b.machine;

export function hostTarget() {
  const saved = shared("voice.settingsTarget");
  if (saved && Object.hasOwn(providers, saved.provider) && (saved.machine === null || typeof saved.machine === "string"))
    return { provider: saved.provider, machine: saved.machine };
  const form = connection();
  return { provider: form.provider === "grok" ? "grok" : "codex", machine: targets().machine };
}

function parseSnapshot(data, target) {
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  if (!object(data) || typeof data.identity !== "string" || !data.identity ||
      !sameTarget(data.target, target) || data.provider !== target.provider ||
      typeof data.scope !== "string" || !object(data.config) || !object(data.catalogs) ||
      !Array.isArray(data.editableKeys) || !data.editableKeys.every(key => typeof key === "string" && Object.hasOwn(labels, key)) ||
      !object(data.semantics) || typeof data.semantics.runtime !== "string") {
    throw new Error("The selected host returned invalid settings. Update its voice extension and reload settings.");
  }
  for (const key of data.editableKeys) {
    const value = data.config[key];
    if (key === "contextModel" && data.provider !== "grok") {
      if (value !== null && (!object(value) || typeof value.provider !== "string" || typeof value.modelId !== "string"))
        throw new Error("The host returned an invalid context model.");
    } else if (!["string", "boolean", "number"].includes(typeof value)) {
      throw new Error("The host returned an invalid value for " + labels[key] + ".");
    }
  }
  return data;
}

export class HostSettings {
  constructor(cx) {
    this.loaded = null;
    this.draft = {};
    this.busy = null;
    this.error = this.message = null;
    this.choices = {};
    this.inputs = {};
    for (const [key, label] of Object.entries(labels)) {
      const width = key.toLowerCase().includes("voice") ? 220 : key.toLowerCase().includes("reasoning") ? 180 : 360;
      this.choices[key] = new Choice("voice-host-" + key, label, cx, width);
    }
    for (const key of textKeys) {
      const state = InputState.new();
      state.on("change", (_e, cx) => { this.draft[key] = state.value(); this.message = null; cx.notify(); });
      this.inputs[key] = state;
    }
    this.machineChoice = new Choice("voice-settings-machine", "Host", cx, 300);
    this.providerChoice = new Choice("voice-settings-provider", "Extension", cx, 200);
    // Pin the initial host; changing pane focus must not change a settings editor.
    setShared("voice.settingsTarget", hostTarget());
    this.transfer(cx);
  }

  selectors() {
    const target = hostTarget();
    const select = (key, value, cx) => {
      setShared("voice.settingsTarget", { ...hostTarget(), [key]: value });
      this.loaded = null;
      this.error = this.message = null;
      this.transfer(cx);
    };
    const hosts = machines().map(m => ({ value: m.name, label: (m.name || "This computer") + (m.layout === "ready" ? "" : " (unavailable)"), disabled: m.layout !== "ready" }));
    if (!hosts.some(m => m.value === target.machine)) hosts.push({ value: target.machine, label: (target.machine || "This computer") + " (unavailable)", disabled: true });
    return v_flex().w_full().gap(16)
      .child(this.machineChoice.render(hosts, target.machine, (value, cx) => select("machine", value, cx), Boolean(this.busy)))
      .child(this.providerChoice.render(Object.entries(providers).map(([value, label]) => ({ value, label })), target.provider,
        (value, cx) => select("provider", value, cx), Boolean(this.busy)));
  }

  current(target = hostTarget()) { return Boolean(this.loaded && sameTarget(this.loaded.target, target)); }

  patch() {
    if (!this.loaded) return {};
    const patch = {};
    for (const key of this.loaded.editableKeys) {
      let value = this.draft[key];
      if (key === "speed" || key === "silenceSeconds") {
        value = String(value).trim() === "" ? NaN : Number(value);
        if (!Number.isFinite(value) || (key === "speed" ? value <= 0 : value < 0))
          throw new Error(labels[key] + " must be " + (key === "speed" ? "positive." : "zero or greater."));
      }
      if (!equal(value, this.loaded.config[key])) patch[key] = value;
    }
    return patch;
  }

  dirty() {
    try { return Object.keys(this.patch()).length > 0; }
    catch (_) { return true; }
  }

  transfer(cx, save = false) {
    if (this.busy) return;
    const target = hostTarget();
    this.operationTarget = target;
    let patch;
    if (save) {
      if (!this.current(target)) { this.error = "The target changed. Load its settings before saving."; cx.notify(); return; }
      try { patch = this.patch(); }
      catch (error) { this.error = error.message; cx.notify(); return; }
      if (!Object.keys(patch).length) return;
    }
    const body = save ? { ...target, identity: this.loaded.identity, patch } : target;
    // Native loading invalidates the previous editor token even if the new load fails.
    if (!save) this.loaded = null;
    this.busy = save ? "Saving" : "Loading";
    this.error = this.message = null;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const data = parseSnapshot(await request(save ? "/settings/save" : "/settings/load", body), target);
        // Focus and selection can change while the remote host is replying.
        if (sameTarget(target, hostTarget())) {
          this.loaded = data;
          this.draft = { ...data.config };
          for (const key of textKeys) this.inputs[key].set_value(String(data.config[key] ?? ""));
          this.message = save ? "Saved on " + (target.machine || "this computer") + ". Applies to the next call." : null;
        }
      } catch (error) { if (sameTarget(target, hostTarget())) this.error = error.message; }
      this.busy = null;
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const target = hostTarget();
    const current = this.current(target);
    const data = current ? this.loaded : null;
    const locked = Boolean(this.busy);
    const set = (key, value, cx) => { this.draft[key] = value; this.message = null; cx.notify(); };
    const options = (key, catalog, values = this.loaded.catalogs[catalog]) => {
      if (!Array.isArray(values)) return [];
      const modelLabels = { "codex-live-1.1": "Codex Live (OAuth)", "realtime-2.1": "GPT Realtime 2.1 (API)", "realtime-2.1-mini": "GPT Realtime 2.1 Mini (API)" };
      return values.filter(value => typeof value === "string" || typeof value === "number").map(value => ({ value, label: key === "model" ? modelLabels[value] || String(value) : String(value) }));
    };
    const choice = (key, catalog, values) => {
      if (!data.editableKeys.includes(key)) return div();
      const list = options(key, catalog, values);
      if (!list.some(option => equal(option.value, this.draft[key]))) list.push({ value: this.draft[key], label: String(this.draft[key]) });
      return this.choices[key].render(list, this.draft[key], (value, cx) => set(key, value, cx), locked);
    };
    const field = key => !data.editableKeys.includes(key) ? div() : v_flex().w_full().max_w(360).gap(5)
      .child(div().text_size(12).text_color(t.muted).child(labels[key]))
      .child(Input.new(this.inputs[key]).accessibility_label(labels[key]).disabled(locked).w_full().h(32).px(8)
        .rounded(6).border_1().border_color(t.border).bg(t.background).text_color(t.foreground));
    const check = key => Checkbox.new("voice-host-" + key).accessibility_label(labels[key]).checked(Boolean(this.draft[key]))
      .disabled(locked || (key === "webSearch" && data.catalogs.webSearchAvailable === false && !this.draft[key]))
      .w_full().py(4).on_change((value, cx) => set(key, value, cx))
      .child(h_flex().w_full().gap(8).items_center()
        .child(div().size(16).flex_none().rounded(3).border_1().border_color(t.border).bg(t.background)
          .when(Boolean(this.draft[key]), el => el.child(icon("check", 14))))
        .child(div().child(labels[key])));
    const context = () => {
      if (!data.editableKeys.includes("contextModel")) return div();
      const value = this.draft.contextModel;
      if (data.provider === "grok") return choice("contextModel", "contextModels");
      const models = Array.isArray(data.catalogs.contextModels) ? data.catalogs.contextModels : [];
      const list = [{ value: "null", label: "Off" }, ...models.filter(model => model && typeof model.provider === "string" && typeof model.modelId === "string")
        .map(model => ({ value: JSON.stringify(model), label: model.provider + "/" + model.modelId }))];
      if (value && !list.some(option => option.value === JSON.stringify(value))) list.push({ value: JSON.stringify(value), label: value.provider + "/" + value.modelId });
      return this.choices.contextModel.render(list, JSON.stringify(value), (next, cx) => set("contextModel", JSON.parse(next), cx), locked);
    };
    const section = label => div().pt(6).font_semibold().child(label);
    const codex = data && this.draft.model === "codex-live-1.1";
    return v_flex().w_full().gap(14)
      .child(h_flex().w_full().gap(8).items_center()
        .child(div().flex_1().font_semibold().child(providers[target.provider]))
        .child(textButton("voice-host-load", this.busy === "Loading" ? "Loading…" : "Reload",
          (_e, cx) => this.transfer(cx), locked)))
      .when(Boolean(data), el => el
        .child(div().text_size(12).text_color(t.muted).child(data.scope + " settings · next call"))
        .child(choice("model", data.provider === "grok" ? "models" : "voiceModels"))
        .when(data.provider !== "grok", el => el
          .child(div().text_size(12).text_color(t.muted).child(codex ? "Uses the Pi host’s Codex login." : "Uses the Pi provider’s API key. API usage is billed separately."))
          .when(!codex, el => el.child(field("apiProvider"))))
        .child(choice(data.provider === "grok" ? "voice" : codex ? "v3Voice" : "realtimeVoice", data.provider === "grok" || codex ? "voices" : "realtimeVoices"))
        .child(choice(data.provider === "grok" ? "alternateVoice" : codex ? "v3AlternateVoice" : "realtimeAlternateVoice", data.provider === "grok" || codex ? "voices" : "realtimeVoices"))
        .when(data.provider === "grok", el => el.child(choice("reasoning", "reasoningLevels")).child(field("speed")).child(field("language")).child(field("silenceSeconds")))
        .child(section("Pi context"))
        .child(context())
        .child(choice("contextReasoning", "contextReasoningLevels"))
        .when(Boolean(codex), el => el
          .child(div().text_color(t.muted).child("Task model: " + data.config.taskDelegationModel))
          .child(choice("taskDelegationReasoning", "contextReasoningLevels")))
        .child(section("Behaviour"))
        .children(data.editableKeys.filter(key => typeof this.draft[key] === "boolean" && (key !== "webSearch" || !codex)).map(check))
        .when(data.catalogs.webSearchAvailable === false && !codex, el => el.child(div().text_color(t.muted).child("Web search is unavailable on this Pi host.")))
        .child(textButton("voice-host-save", this.busy === "Saving" ? "Saving…" : "Save host settings", (_e, cx) => this.transfer(cx, true), locked || !this.dirty())))
      .when(Boolean(this.error) && sameTarget(this.operationTarget, target), el => el.child(div().text_color(t.blocked).child(this.error)))
      .when(Boolean(this.message) && current, el => el.child(div().text_color(t.foreground).child(this.message)));
  }
}
