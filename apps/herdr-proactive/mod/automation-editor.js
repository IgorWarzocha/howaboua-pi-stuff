import { div } from "gpui-kit";
import { InputState, TextareaState, h_flex } from "gpui-base";
import { Choice } from "./select.js";
import { Duration } from "./cadence.js";
import { newId } from "./state.js";
import { section, field, check, muted, instructionFile } from "./ui.js";

const weekdays = [1, 2, 3, 4, 5, 6, 0];
const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export class AutomationEditor {
  constructor(policy, job, workspace, cx) {
    this.parent = policy ? JSON.parse(JSON.stringify(policy)) : null;
    this.workspace = workspace;
    this.fresh = !job;
    this.draft = job ? JSON.parse(JSON.stringify(job)) : { id: newId(), enabled: true };
    this.original = job ? JSON.parse(JSON.stringify(job)) : null;
    this.kind = job?.schedule.kind ?? "interval";
    this.days = [...(job?.schedule.days ?? [1])];
    // Preserve absent anchors and sub-minute one-off timestamps on unchanged edits.
    this.anchor = job ? job.schedule.anchor : Date.now();
    this.originalAt = job?.schedule.kind === "once" ? job.schedule.at : null;
    const at = new Date(this.originalAt ?? Date.now() + 86400000).toISOString().slice(0, 16);
    this.originalAtText = at;
    this.name = InputState.new({ value: job?.name ?? "Automation" });
    this.prompt = TextareaState.new({ value: job?.prompt ?? "", rows: 4 });
    this.duration = new Duration("automation-duration", job?.schedule.minutes ?? 240, cx);
    this.time = InputState.new({ value: job?.schedule.time ?? "09:00" });
    this.date = InputState.new({ value: at.slice(0, 10) });
    this.onceTime = InputState.new({ value: at.slice(11) });
    this.scheduleChoice = new Choice("automation-schedule", "Schedule", cx);
    this.parentChoice = new Choice("automation-parent", "Check-in", cx);
    this.more = false;
    this.error = null;
  }

  schedule() {
    if (this.kind === "interval") return { kind: "interval", minutes: this.duration.value(1, 525600),
      ...(this.anchor === undefined ? {} : { anchor: this.anchor }) };
    if (this.kind === "once") {
      const date = this.date.value().trim();
      const time = this.onceTime.value().trim();
      const text = date + "T" + time;
      if (!/^\d{4}-\d\d-\d\d$/.test(date) || !validTime(time))
        throw new Error("Enter a date as YYYY-MM-DD and a UTC time as HH:MM.");
      const at = this.originalAt !== null && text === this.originalAtText ? this.originalAt : Date.parse(text + ":00Z");
      if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 16) !== text)
        throw new Error("Choose a valid calendar date and UTC time.");
      if (at <= Date.now() && at !== this.originalAt) throw new Error("Choose a date and time in the future (UTC).");
      return { kind: "once", at };
    }
    const time = this.time.value().trim();
    if (!validTime(time)) throw new Error("Enter a UTC time as HH:MM, from 00:00 to 23:59.");
    if (this.kind === "daily") return { kind: "daily", time };
    if (!this.days.length) throw new Error("Choose at least one day.");
    return { kind: "weekly", time, days: [...this.days].sort() };
  }

  value(status) {
    if (!this.parent || !status.policies.some(p => p.id === this.parent.id && p.space === this.workspace))
      throw new Error("Choose an existing check-in in this workspace.");
    if (!status.workspaces.some(w => w.id === this.workspace && w.root))
      throw new Error("This workspace needs a folder. Go back and choose a workspace with a folder.");
    const name = this.name.value().trim();
    const prompt = this.prompt.value();
    if (!name || name.length > 100) throw new Error("Enter a name of up to 100 characters.");
    if (!prompt.trim()) throw new Error("Add instructions for the automation.");
    if (prompt.length > 64000) throw new Error("Shorten the instructions to 64,000 characters or fewer.");
    const job = { ...this.draft, name, prompt, schedule: this.schedule() };
    const jobs = this.parent.jobs.map(old => old.id === job.id ? job : old);
    if (!jobs.some(old => old.id === job.id)) jobs.push(job);
    return { ...this.parent, jobs };
  }

  render(status, _target, locked) {
    const parents = status.policies.filter(p => p.space === this.workspace);
    const agentName = p => status.terminals.find(t => t.address === p.terminal && t.space === p.space)?.name || "Agent unavailable";
    if (this.fresh && !parents.length) return section()
      .child(div().child("Add a check-in first to choose which agent receives this automation."));
    const root = status.workspaces.find(w => w.id === this.workspace)?.root;
    const path = this.draft.path ?? (root ? root.replace(/\/$/, "") + "/pulses/" + this.draft.id + "/PULSE.md" : null);
    const set = (key, value, cx) => { this[key] = value; this.error = null; cx.notify(); };
    return section()
      .when(this.fresh, el => el.child(this.parentChoice.render(parents.map(p => ({ value: p.id, label: p.name + " · " + agentName(p) })),
        this.parent?.id, (id, cx) => {
          this.parent = JSON.parse(JSON.stringify(parents.find(p => p.id === id))); this.error = null; cx.notify();
        }, locked)))
      .when(!this.fresh && Boolean(this.parent), el => el.child(muted(this.parent.name + " · " + agentName(this.parent))))
      .child(field(this.name, "Name", locked))
      .child(field(this.prompt, "Instructions", locked, true))
      .child(this.scheduleChoice.render([
        { value: "interval", label: "Every so often" }, { value: "daily", label: "Every day" },
        { value: "weekly", label: "On chosen days" }, { value: "once", label: "Once" },
      ], this.kind, (value, cx) => set("kind", value, cx), locked))
      .when(this.kind === "interval", el => el.child(this.duration.render("Every", locked)))
      .when(this.kind === "once", el => el.child(h_flex().gap(12)
        .child(div().flex_1().min_w(0).child(field(this.date, "Date", locked)))
        .child(div().flex_1().min_w(0).child(field(this.onceTime, "Time (UTC)", locked)))))
      .when(["daily", "weekly"].includes(this.kind), el => el.child(field(this.time, "Time (UTC)", locked)))
      .when(this.kind === "weekly", el => el.child(h_flex().flex_wrap().gap(10).children(weekdays.map(day =>
        check("automation-day-" + day, dayLabels[day], this.days.includes(day), (value, cx) => {
          this.days = value ? [...this.days, day] : this.days.filter(d => d !== day); this.error = null; cx.notify();
        }, locked)))))
      .child(check("automation-active", "Active", this.draft.enabled, (value, cx) => {
        this.draft.enabled = value; this.error = null; cx.notify();
      }, locked))
      .when(Boolean(this.parent && (!this.parent.enabled || !this.parent.allowTerminalInput)), el =>
        el.child(muted("Saved automations will not run until this check-in is active and sending is allowed.")))
      .when(this.more && Boolean(path), el => el.child(instructionFile(path)));
  }
}
