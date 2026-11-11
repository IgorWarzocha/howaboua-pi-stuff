import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, machines, theme, openOverlay, closeOverlay, shared, setShared, notify } from "herdr";
import { command, parseStatus, focusTarget } from "./state.js";
import { Choice } from "./select.js";
import { CheckInEditor } from "./checkin-editor.js";
import { AutomationEditor } from "./automation-editor.js";
import { EditConflict } from "./edit-conflict.js";
import { renderDashboard, renderDetails, renderActivity, renderConfirmation } from "./dashboard.js";
import { renderSidebar } from "./sidebar.js";
import { iconButton, muted, errorText, layoutWidth } from "./ui.js";

export default class Proactive extends View {
  init(_props, cx) {
    const options = props() ?? {};
    const target = focusTarget();
    this.compact = options.compact === true;
    this.toolbar = options.toolbar === true;
    this.overlay = options.overlay;
    this.machine = options.machine === null || typeof options.machine === "string" ? options.machine : target.machine;
    this.workspace = options.workspace ?? (target.machine === this.machine ? target.space : "");
    this.target = target;
    this.focusKey = JSON.stringify(target);
    this.changed = JSON.stringify(shared("proactive.changed"));
    this.status = null;
    this.loadedAt = null;
    this.error = this.message = this.busy = this.editor = this.confirm = null;
    this.page = "check-ins";
    this.conflict = this.merge = null;
    this.selected = this.snoozing = null;
    this.width = 740;
    this.needsRefresh = false;
    this.startNew = options.create === true;
    this.machineChoice = new Choice("proactive-machine", "Machine", cx);
    this.workspaceChoice = new Choice("proactive-workspace", "Workspace", cx);
    this.snoozeChoice = new Choice("proactive-snooze", "Resume in", cx);
    this.snoozeMinutes = 60;
    this.refresh(cx);
  }

  refresh(cx, redraw = true) {
    if (this.busy) { this.needsRefresh = true; return; }
    this.busy = "status";
    this.needsRefresh = false;
    const machine = this.machine;
    cx.spawn(async cx => {
      try {
        const status = parseStatus(await command(machine, "status"));
        if (machine === this.machine) {
          this.status = status;
          this.loadedAt = Date.now();
          if (!this.conflict) this.error = null;
          if (!this.compact && !status.workspaces.some(w => w.id === this.workspace)) this.workspace = status.workspaces[0]?.id ?? "";
          if (this.startNew && this.workspace) { this.startNew = false; this.edit(null, cx); }
        }
      } catch (e) { if (machine === this.machine) { this.status = null; this.error = e.message; } }
      this.busy = null;
      cx.notify();
      if (this.needsRefresh) this.refresh(cx);
    });
    if (redraw) cx.notify();
  }

  act(action, payload, cx) {
    if (this.busy) return;
    this.busy = action;
    this.error = this.message = null;
    const machine = this.machine;
    cx.notify();
    cx.spawn(async cx => {
      try {
        await command(machine, action, payload);
        this.confirm = this.snoozing = null;
        if (action === "configure") { this.editor = null; this.conflict = this.merge = null; }
        this.message = { configure: "Saved.", run: "Check-in queued.", remove: "Removed.",
          reset: "Activity forgotten.", snooze: payload.until > Date.now() ? "Paused." : "Resumed.",
          acknowledge: "Ready to continue. The last message will not be resent." }[action];
        const changed = { machine, at: Date.now() };
        this.changed = JSON.stringify(changed);
        setShared("proactive.changed", changed);
      } catch (e) {
        this.conflict = action === "configure" && this.editor && e.kind === "CONFLICT";
        this.error = this.conflict ? "The file changed. Your draft is kept. Review the changes before saving." : e.message;
        if (this.compact) notify({ title: "Proactive", body: this.error, level: "warning" });
      }
      const actionError = this.error;
      try { this.status = parseStatus(await command(machine, "status")); this.loadedAt = Date.now(); }
      catch (e) { this.status = null; this.error = [actionError, e.message].filter(Boolean).join(" "); }
      this.busy = null;
      cx.notify();
      if (this.needsRefresh) this.refresh(cx);
    });
  }

  edit(policy, cx) {
    const terminal = this.target.machine === this.machine && this.target.space === this.workspace &&
      this.status.terminals.some(t => t.address === this.target.terminal && t.space === this.workspace) ? this.target.terminal : "";
    this.editor = new CheckInEditor(policy, this.workspace, terminal, cx);
    this.editorTitle = policy ? "Edit check-in" : "New check-in";
    this.conflict = this.merge = null;
    this.confirm = this.message = null;
    this.page = "check-ins";
    cx.notify();
  }

  editAutomation(policy, job, cx) {
    this.editor = new AutomationEditor(policy, job, this.workspace, cx);
    this.editorTitle = job ? "Edit automation" : "New automation";
    this.conflict = this.merge = null;
    this.confirm = this.message = null;
    this.page = "check-ins";
    cx.notify();
  }

  toggle(policy, snoozed, cx) {
    if (!policy.enabled && !policy.allowTerminalInput) { this.edit(policy, cx); return; }
    if (policy.enabled && snoozed) this.act("snooze", { id: policy.id, until: 0 }, cx);
    else this.act("configure", { ...policy, enabled: !policy.enabled }, cx);
  }

  saveEditor(cx) {
    try { this.act("configure", this.editor.value(this.status), cx); }
    catch (error) { this.error = error.message; cx.notify(); }
  }

  reviewChanges(cx) {
    try {
      const mine = this.editor.value(this.status);
      const latest = this.status.policies.find(p => p.id === mine.id);
      if (!latest) throw new Error("This check-in is no longer available. Your draft is still open.");
      const automation = this.editor instanceof AutomationEditor;
      const job = automation ? mine.jobs.find(j => j.id === this.editor.draft.id) : null;
      const latestJob = automation ? latest.jobs.find(j => j.id === job.id) : null;
      if (automation && this.editor.original && !latestJob)
        throw new Error("This automation is no longer available. Your draft is still open.");
      this.merge = new EditConflict(this.editor.original, automation ? job : mine, automation ? latestJob ?? job : latest, automation, this.status);
      this.merge.parent = latest;
      this.merge.mine = mine;
      this.merge.rebind = this.editor.rebind;
      this.error = null;
    } catch (error) { this.error = error.message; }
    cx.notify();
  }

  acceptChanges(cx) {
    const merged = this.merge.value();
    if (this.editor instanceof AutomationEditor) {
      this.editor = new AutomationEditor(this.merge.parent, merged, this.workspace, cx);
      this.editor.original = this.merge.parent.jobs.find(job => job.id === merged.id) ?? null;
    } else {
      // Sending permission belongs to the agent the user actually consented to.
      if (merged.terminal !== this.merge.mine.terminal) { merged.enabled = false; merged.allowTerminalInput = false; }
      this.editor = new CheckInEditor(merged, this.workspace, merged.terminal, cx);
      this.editor.original = this.merge.parent;
      this.editor.rebind = Boolean(this.merge.rebind && merged.terminal === this.merge.mine.terminal);
    }
    this.conflict = this.merge = null;
    this.error = null;
    this.message = "Changes combined. Review and save.";
    cx.notify();
  }

  snooze(policy, cx) {
    this.act("snooze", { id: policy.id, until: Date.now() + this.snoozeMinutes * 60000 }, cx);
  }

  changeAutomation(policy, job, action, cx) {
    const removedJobs = [...(policy.removedJobs ?? [])];
    if (action === "remove" && typeof job.revision === "string") removedJobs.push({ id: job.id, revision: job.revision });
    const jobs = action === "remove" ? policy.jobs.filter(item => item.id !== job.id) :
      policy.jobs.map(item => item.id === job.id ? { ...item, enabled: !item.enabled } : item);
    this.act("configure", { ...policy, jobs, removedJobs }, cx);
  }

  confirmAction(action, payload, cx) { this.confirm = { action, payload }; cx.notify(); }

  confirmed(cx) {
    const { action, payload } = this.confirm;
    if (action !== "removeAutomation") { this.act(action, payload, cx); return; }
    const policy = this.status.policies.find(p => p.id === payload.id);
    const job = policy?.jobs.find(j => j.id === payload.job);
    if (job) this.changeAutomation(policy, job, "remove", cx);
    else { this.confirm = null; this.error = "This automation has changed. Refresh and try again."; cx.notify(); }
  }

  expand(create = false) {
    // Sidebar status can still belong to the preceding workspace while loading.
    // Capture focus at the click; the dialog then owns its selected context.
    const target = this.compact ? focusTarget() : { machine: this.machine, space: this.workspace };
    if (this.overlay) closeOverlay(this.overlay);
    openOverlay({ mod: "proactive", kind: "dialog", width: 740,
      props: { machine: target.machine, workspace: target.space, create } });
  }

  observeFocus(cx) {
    const changed = shared("proactive.changed");
    const revision = JSON.stringify(changed);
    if (revision !== this.changed) {
      this.changed = revision;
      if (changed?.machine === this.machine) this.refresh(cx, false);
    }
    const target = focusTarget();
    if (!target.space) return;
    const key = JSON.stringify(target);
    if (key === this.focusKey) return;
    this.focusKey = key;
    this.target = target;
    if (this.compact) { this.machine = target.machine; this.workspace = target.space; this.status = null; }
    if (!this.editor) this.refresh(cx, false);
  }

  render(cx) {
    this.observeFocus(cx);
    if (this.compact) return renderSidebar(this);
    const t = theme();
    const locked = Boolean(this.busy);
    const choosing = locked || Boolean(this.editor);
    const hosts = machines().map(m => ({ value: m.name, label: (m.name || "This computer") +
      (m.layout === "ready" ? "" : " (unavailable)"), disabled: m.layout !== "ready" }));
    if (!hosts.some(m => m.value === this.machine)) hosts.push({ value: this.machine, label: (this.machine || "This computer") + " (unavailable)", disabled: true });
    const machineField = this.machineChoice.render(hosts, this.machine, (value, cx) => {
      this.machine = value; this.workspace = ""; this.status = null; this.confirm = this.message = null; this.refresh(cx);
    }, choosing);
    const workspaceField = this.workspaceChoice.render((this.status?.workspaces ?? []).map(w => ({ value: w.id, label: w.name || w.id })),
      this.workspace, (value, cx) => { this.workspace = value; this.confirm = this.message = this.selected = this.snoozing = null; cx.notify(); }, choosing || !this.status);
    const context = layoutWidth(this.width) < 560 ? v_flex().gap(12).child(machineField).child(workspaceField) :
      h_flex().gap(16).child(div().w(200).flex_none().child(machineField)).child(div().flex_1().min_w(0).child(workspaceField));
    const content = v_flex().w_full().min_w(0).gap(20).when(!this.editor, el => el.child(context))
      .when(Boolean(this.message), el => el.child(div().text_color(t.done).child(this.message)))
      .when(!this.status && !this.error, el => el.child(muted("Loading check-ins.")))
      .when(Boolean(this.status), el => {
        if (this.merge) return el.child(this.merge.render());
        if (this.editor) return el.child(this.editor.render(this.status, { ...this.target, selectedMachine: this.machine }, locked));
        if (this.page === "details") return el.child(renderDetails(this));
        if (this.page === "activity") return el.child(renderActivity(this));
        return el.when(!this.status.service.running, node => node.child(errorText("Automatic messages are stopped on " + (this.machine || "this computer") + ".")))
          .when(this.status.errors.length > 0, node => node.child(errorText("Some instruction files need attention. Open Details to inspect them.")))
          .child(renderDashboard(this));
      });
    return v_flex().id("proactive-settings").w_full().h(620).min_h(0).bg(t.chrome).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } })
      .child(h_flex().h(48).px(16).flex_none().gap(8).items_center()
        .when(Boolean(this.editor), el => el.child(iconButton("proactive-discard", "back", this.merge ? "Back to my draft" : "Back without saving", (_e, cx) => {
          if (this.merge) this.merge = null;
          else { this.editor = null; this.conflict = null; }
          this.error = null; cx.notify();
        }, locked)))
        .when(this.page !== "check-ins" && !this.editor, el => el.child(iconButton("proactive-back", "back", "Back to check-ins",
          (_e, cx) => { this.page = "check-ins"; this.confirm = null; cx.notify(); })))
        .child(div().flex_1().min_w(0).truncate().font_semibold().tooltip(this.editor ? this.editorTitle : "Proactive").child(this.merge ? "Review changes" : this.editor ? this.editorTitle : "Proactive"))
        .when(Boolean(this.editor && !this.merge), el => el
          .child(iconButton("proactive-editor-more", "settings", "More options", (_e, cx) => { this.editor.more = !this.editor.more; cx.notify(); }, locked, this.editor.more))
          .when(Boolean(this.conflict), node => node.child(iconButton("proactive-review", "edit", "Review file changes", (_e, cx) => this.reviewChanges(cx), locked || !this.status, true)))
          .child(iconButton("proactive-save", "check", "Save", (_e, cx) => this.saveEditor(cx), locked || !this.status || Boolean(this.conflict))))
        .when(Boolean(this.merge), el => el.child(iconButton("proactive-combine", "check", "Review combined draft", (_e, cx) => this.acceptChanges(cx), locked)))
        .when(!this.editor, el => el
          .child(iconButton("proactive-activity", "activity", "Workspace activity", (_e, cx) => { this.page = this.page === "activity" ? "check-ins" : "activity"; this.confirm = null; cx.notify(); }, locked, this.page === "activity"))
          .child(iconButton("proactive-details", "info", "Details", (_e, cx) => { this.page = this.page === "details" ? "check-ins" : "details"; this.confirm = null; cx.notify(); }, locked, this.page === "details")))
        .child(iconButton("proactive-refresh", "refresh", "Refresh check-ins", (_e, cx) => this.refresh(cx), locked || Boolean(this.merge)))
        .when(Boolean(this.overlay), el => el.child(iconButton("proactive-close", "x", "Close Proactive", () => closeOverlay(this.overlay)))))
      .when(Boolean(this.error), el => el.child(errorText(this.error).px(16).pb(12).flex_none()))
      .child(v_flex().id("proactive-scroll").flex_1().min_h(0).overflow_y_scrollbar().px(16).pb(16).child(content))
      .when(Boolean(this.confirm && this.status), el => el.child(renderConfirmation(this).px(16).pb(16).flex_none()));
  }
}
