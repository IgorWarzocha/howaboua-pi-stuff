import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme } from "herdr";
import { heading, iconButton, muted, errorText, section, instructionFile } from "./ui.js";
import { dateLabel, durationLabel, scheduleLabel } from "./state.js";

export function checkInStatus(policy, runtime, running) {
  if (!policy.enabled) return "Paused";
  if (!running) return "Background service stopped";
  if (runtime?.awaitingAck) return "Check the last message before continuing";
  if (runtime?.snoozedUntil > Date.now()) return "Paused until " + dateLabel(runtime.snoozedUntil);
  if (runtime?.inflight) return "Sending";
  if (runtime?.reason?.includes("process changed")) return "Choose the agent again";
  if (runtime?.reason?.includes("unavailable")) return "Agent unavailable";
  if (runtime?.reason?.includes("moved")) return "Agent moved to another workspace";
  if (runtime?.pendingUnseen && !policy.jobs.some(job => job.enabled)) return "Waiting for you to read the last result";
  if (runtime?.reason?.startsWith("Waiting for idle")) return "Waiting for the agent";
  if (runtime?.nextAt) return "Next · " + dateLabel(runtime.nextAt);
  return policy.mode === "off" ? "Only when asked or scheduled" : "Ready";
}

function checkInRow(view, policy) {
  const busy = Boolean(view.busy);
  const runtime = view.status.runtime[policy.id];
  const snoozed = runtime?.snoozedUntil > Date.now();
  const active = policy.enabled && !snoozed;
  const agent = view.status.terminals.find(t => t.address === policy.terminal);
  const timing = policy.mode === "adaptive" ? "Matches your activity" : policy.mode === "fixed" ?
    "Every " + durationLabel(policy.minMinutes) : "Only when asked";
  return v_flex().min_w(0).gap(6).py(8)
    .child(h_flex().gap(8).items_center()
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().truncate().tooltip(policy.name).child(policy.name))
        .child(muted(agent?.name || "Agent unavailable").truncate().tooltip(agent?.name || policy.terminal)))
      .child(iconButton("run-" + policy.id, "target", "Check in now · " + policy.name,
        (_e, cx) => view.act("run", { id: policy.id }, cx), busy || !policy.enabled || !policy.allowTerminalInput || !policy.prompt.trim() || !view.status.service.running))
      .child(iconButton("pause-" + policy.id, active ? "pause" : "play", active ? "Pause " + policy.name : "Resume " + policy.name,
        (_e, cx) => view.toggle(policy, snoozed, cx), busy))
      .child(iconButton("edit-" + policy.id, "settings", "Edit " + policy.name, (_e, cx) => view.edit(policy, cx), busy))
      .child(iconButton("more-" + policy.id, "chevron-down", "More actions for " + policy.name,
        (_e, cx) => { view.selected = view.selected === policy.id ? null : policy.id; cx.notify(); }, busy, view.selected === policy.id)))
    .child(muted(checkInStatus(policy, runtime, view.status.service.running)))
    .child(muted(timing + (policy.mode === "adaptive" ? " · At least " + durationLabel(policy.minMinutes) + " apart" : "")))
    .when(Boolean(runtime?.awaitingAck), el => el.child(h_flex().gap(8).items_center()
      .child(errorText("The last message may have been sent. Read the agent before continuing.").flex_1())
      .child(iconButton("ack-" + policy.id, "check", "I checked the agent. Continue without resending.",
        (_e, cx) => view.confirmAction("acknowledge", { id: policy.id }, cx), busy))))
    .when(view.snoozing === policy.id, el => el.child(h_flex().gap(8).items_end()
      .child(div().flex_1().child(view.snoozeChoice.render([
        { value: 30, label: "30 minutes" }, { value: 60, label: "1 hour" }, { value: 240, label: "4 hours" }, { value: 1440, label: "1 day" },
      ], view.snoozeMinutes, (value, cx) => { view.snoozeMinutes = value; cx.notify(); }, busy)))
      .child(iconButton("snooze-save", "check", "Pause for this long", (_e, cx) => view.snooze(policy, cx), busy))
      .child(iconButton("snooze-cancel", "x", "Cancel timed pause", (_e, cx) => { view.snoozing = null; cx.notify(); }, busy))))
    .when(view.selected === policy.id, el => el.child(h_flex().gap(4).items_center()
      .child(muted(policy.enabled ? "More actions" : "Paused").flex_1())
      .child(iconButton("snooze-" + policy.id, "clock", "Pause for a while", (_e, cx) => { view.snoozing = policy.id; cx.notify(); }, busy || !policy.enabled))
      .child(iconButton("remove-" + policy.id, "trash", "Remove " + policy.name, (_e, cx) => view.confirmAction("remove", { id: policy.id }, cx), busy))));
}

function automationRow(view, policy, job) {
  const busy = Boolean(view.busy);
  return h_flex().min_w(0).gap(8).py(8).items_center()
    .child(v_flex().flex_1().min_w(0).gap(4)
      .child(div().truncate().tooltip(job.name).child(job.name))
      .child(muted(scheduleLabel(job.schedule)))
      .child(muted(policy.name + (!policy.enabled ? " · Agent paused" : !job.enabled ? " · Paused" : ""))))
    .child(iconButton("automation-pause-" + job.id, job.enabled ? "pause" : "play",
      (job.enabled ? "Pause " : "Resume ") + job.name, (_e, cx) => view.changeAutomation(policy, job, "toggle", cx), busy))
    .child(iconButton("automation-edit-" + job.id, "settings", "Edit " + job.name,
      (_e, cx) => view.editAutomation(policy, job, cx), busy))
    .child(iconButton("automation-remove-" + job.id, "trash", "Remove " + job.name,
      (_e, cx) => view.confirmAction("removeAutomation", { id: policy.id, job: job.id }, cx), busy));
}

export function renderConfirmation(view) {
  const { action, payload } = view.confirm;
  const checkIn = view.status.policies.find(p => p.id === payload.id);
  const title = { remove: "Remove " + (checkIn?.name || "this check-in") + "?", removeAutomation: "Remove this automation?",
    reset: "Forget this workspace’s activity?", acknowledge: "Continue without resending the last message?" }[action];
  return section().pt(12).border_t_1().border_color(theme().border).child(heading(title, [
    iconButton("confirm-action", "check", "Confirm", (_e, cx) => view.confirmed(cx), Boolean(view.busy)),
    iconButton("cancel-action", "x", "Cancel", (_e, cx) => { view.confirm = null; cx.notify(); }, Boolean(view.busy)),
  ])).when(action === "remove" && Boolean(checkIn?.jobs.length), el => el.child(errorText("Its automations will also be removed. Journals and other files stay.")));
}

export function renderDashboard(view) {
  const rows = view.status.policies.filter(p => p.space === view.workspace);
  const busy = Boolean(view.busy);
  const hasRoot = view.status.workspaces.some(w => w.id === view.workspace && w.root);
  return section().gap(24)
    .child(section().gap(4).child(heading("Check-ins", [
      iconButton("checkin-new", "plus", "Add a check-in", (_e, cx) => view.edit(null, cx), busy || !hasRoot),
    ])).when(!rows.length, el => el.child(muted("No check-ins yet."))).children(rows.map(p => checkInRow(view, p))))
    .child(section().gap(4).pt(16).border_t_1().border_color(theme().border).child(heading("Automations", [
      iconButton("automation-new", "plus", rows.length ? "Add an automation" : "Add a check-in before adding an automation",
        (_e, cx) => view.editAutomation(null, null, cx), busy || !rows.length),
    ])).when(!rows.some(p => p.jobs.length), el => el.child(muted(rows.length ? "No automations yet." : "Add a check-in to choose an agent first.")))
      .children(rows.flatMap(p => p.jobs.map(job => automationRow(view, p, job)))));
}

export function renderDetails(view) {
  const workspace = view.status.workspaces.find(w => w.id === view.workspace);
  const rows = view.status.policies.filter(p => p.space === view.workspace);
  return section().child(heading("Details"))
    .child(div().child(view.status.service.running ? "Background service running" : "Background service stopped"))
    .when(Boolean(view.status.service.error), el => el.child(errorText(view.status.service.error)))
    .child(muted("Last connected · " + dateLabel(view.loadedAt)))
    .when(Boolean(workspace?.root), el => el.child(instructionFile(workspace.root)))
    .children(view.status.errors.map(error => section().gap(4).child(errorText(error.message)).child(instructionFile(error.path))))
    .children(rows.map(p => section().pt(8).border_t_1().border_color(theme().border).gap(6)
      .child(heading(p.name)).child(instructionFile(p.path))
      .child(muted(view.status.runtime[p.id]?.reason || "No messages sent"))
      .when(Boolean(view.status.runtime[p.id]?.lastError), el => el.child(errorText(view.status.runtime[p.id].lastError)))
      .children(p.jobs.map(job => instructionFile(job.path)))));
}

export function renderActivity(view) {
  const summary = view.status.activity[view.workspace];
  const observed = summary?.monthly?.observedHours > 0;
  return section().child(heading("Activity", [
    iconButton("history-reset", "reset", "Forget this workspace’s activity",
      (_e, cx) => view.confirmAction("reset", { space: view.workspace }, cx), Boolean(view.busy)),
  ])).child(muted(observed ? "Viewed results help check-ins find a useful time." : "No activity learned yet."))
    .children(observed ? [["weekly", "This week"], ["monthly", "This month"], ["past", "Previous months"]].map(([key, label]) =>
      h_flex().gap(8).child(div().flex_1().child(label)).child(muted(String(summary[key]?.engagements ?? 0) + " visits"))) : []);
}
