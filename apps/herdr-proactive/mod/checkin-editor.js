import { div } from "gpui-kit";
import { InputState, TextareaState, h_flex } from "gpui-base";
import { Choice } from "./select.js";
import { Duration } from "./cadence.js";
import { newId } from "./state.js";
import { section, field, check, iconButton, muted, instructionFile } from "./ui.js";

const hours = Array.from({ length: 24 }, (_, value) => ({ value, label: String(value).padStart(2, "0") + ":00" }));

export class CheckInEditor {
  constructor(policy, workspace, terminal, cx) {
    this.fresh = !policy;
    this.draft = policy ? JSON.parse(JSON.stringify(policy)) : {
      id: newId(), name: "Workspace check-in", space: workspace, terminal, scope: "workspace",
      enabled: false, allowTerminalInput: false, mode: "adaptive", prompt: "",
      minMinutes: 240, quietStart: 22, quietEnd: 8, jobs: [],
    };
    this.draft.removedJobs ??= [];
    this.original = policy ? JSON.parse(JSON.stringify(policy)) : null;
    this.name = InputState.new({ value: this.draft.name });
    this.prompt = TextareaState.new({ value: this.draft.prompt, rows: 4 });
    this.duration = new Duration("checkin-duration", this.draft.minMinutes, cx);
    this.choices = {};
    for (const [key, label] of Object.entries({ terminal: "Agent", mode: "Timing", quietStart: "From · UTC", quietEnd: "Until · UTC" }))
      this.choices[key] = new Choice("checkin-" + key, label, cx);
    this.quiet = this.draft.quietStart !== this.draft.quietEnd;
    this.more = false;
    this.error = null;
    this.rebind = false;
  }

  bind(terminal, cx) {
    this.draft.terminal = terminal;
    this.draft.allowTerminalInput = false;
    this.draft.enabled = false;
    this.rebind = true;
    this.error = null;
    cx.notify();
  }

  value(status) {
    const p = { ...this.draft, name: this.name.value().trim(), prompt: this.prompt.value() };
    if (!p.name || p.name.length > 100) throw new Error("Enter a name of up to 100 characters.");
    if (!status.workspaces.some(w => w.id === p.space && w.root))
      throw new Error("This workspace needs a folder. Go back and choose a workspace with a folder.");
    const unchangedAgent = this.original?.terminal === p.terminal && !this.rebind;
    if (!unchangedAgent && !status.terminals.some(t => t.address === p.terminal && t.space === p.space))
      throw new Error("Choose an available agent in this workspace.");
    p.minMinutes = this.duration.value(15, 43200);
    if (this.quiet && p.quietStart === p.quietEnd)
      throw new Error("Choose different start and end times, or turn quiet hours off.");
    if (!this.quiet) p.quietEnd = p.quietStart;
    if (p.mode !== "off" && !p.prompt.trim()) throw new Error("Add instructions, or choose Only when asked.");
    if (p.prompt.length > 64000) throw new Error("Shorten the instructions to 64,000 characters or fewer.");
    if (p.enabled && !p.allowTerminalInput) throw new Error("Allow sending to the agent before making this check-in active.");
    if (this.rebind) p.rebind = true;
    return p;
  }

  render(status, target, locked) {
    const p = this.draft;
    const root = status.workspaces.find(w => w.id === p.space)?.root;
    const path = p.path ?? (root ? root.replace(/\/$/, "") + "/.herdr/proactive/" + p.id + "/PROACTIVE.md" : null);
    const set = (key, value, cx) => {
      p[key] = value;
      if (key === "allowTerminalInput" && !value) p.enabled = false;
      this.error = null; cx.notify();
    };
    const agents = status.terminals.filter(t => t.space === p.space).map(t => ({ value: t.address, label: t.name || "Unnamed agent" }));
    if (p.terminal && !agents.some(t => t.value === p.terminal))
      agents.push({ value: p.terminal, label: "Previous agent · unavailable", disabled: true });
    const focused = target.machine === target.selectedMachine && target.space === p.space &&
      status.terminals.some(t => t.address === target.terminal && t.space === p.space);
    return section().child(field(this.name, "Name", locked))
      .child(h_flex().gap(6).items_end()
        .child(div().flex_1().min_w(0).child(this.choices.terminal.render(agents, p.terminal, (value, cx) => this.bind(value, cx), locked)))
        .child(iconButton("checkin-focus", "target", "Use focused agent and renew sending permission", (_e, cx) => this.bind(target.terminal, cx), locked || !focused)))
      .when(!agents.length, el => el.child(muted("Open an agent in this workspace, then refresh to choose it.")))
      .child(field(this.prompt, "Instructions", locked, true))
      .child(this.choices.mode.render([
        { value: "adaptive", label: "Match my activity" }, { value: "fixed", label: "At a regular interval" }, { value: "off", label: "Only when asked" },
      ], p.mode, (value, cx) => set("mode", value, cx), locked))
      .when(p.mode !== "off", el => el.child(this.duration.render(p.mode === "adaptive" ? "Wait at least" : "Every", locked)))
      .child(check("checkin-consent", "Allow sending to this agent, even if it submits an unfinished draft.", p.allowTerminalInput,
        (value, cx) => set("allowTerminalInput", value, cx), locked))
      .child(check("checkin-active", "Active", p.enabled, (value, cx) => set("enabled", value, cx), locked || !p.allowTerminalInput))
      .when(this.more, el => el
        .child(check("checkin-quiet", "Quiet hours · UTC", this.quiet, (value, cx) => { this.quiet = value; cx.notify(); }, locked))
        .when(this.quiet, row => row.child(h_flex().gap(12)
          .child(div().flex_1().min_w(0).child(this.choices.quietStart.render(hours, p.quietStart, (v, cx) => set("quietStart", v, cx), locked)))
          .child(div().flex_1().min_w(0).child(this.choices.quietEnd.render(hours, p.quietEnd, (v, cx) => set("quietEnd", v, cx), locked)))))
        .when(Boolean(path), row => row.child(instructionFile(path))));
  }
}
