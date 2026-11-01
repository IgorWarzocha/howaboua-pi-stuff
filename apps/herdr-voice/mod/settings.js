import { div } from "gpui-kit";
import { v_flex, h_flex, Input } from "gpui-base";
import { theme, machines, closeOverlay } from "herdr";
import { PROVIDERS, piPanes, connection, targets } from "./state.js";
import { iconButton, textButton } from "./ui.js";

export function renderSettings(view, phase) {
  const t = theme();
  const busy = Boolean(view.pending || view.host.busy);
  const active = ["connecting", "listening", "muted"].includes(view.status?.phase);
  const disabled = busy || active;
  const form = connection();
  const target = targets(form);
  const stacked = view.width < 700;
  const choose = (key, options, value, transform = next => next) => view.choices[key].render(options, value, (next, cx) => {
    view.save(key, transform(next)); cx.notify();
  }, disabled);
  const devices = key => {
    const values = view.devices[key === "microphone" ? "microphones" : "speakers"];
    const options = [{ value: "", label: "System default" }, ...values.map(d => ({ value: d.name, label: d.description || d.name }))];
    if (form[key] && !values.some(d => d.name === form[key]))
      options.push({ value: form[key], label: form[key] + " (not in local list)", disabled: true });
    return choose(key, options, form[key]);
  };
  const field = (key, label) => v_flex().w_full().gap(5)
    .child(div().text_size(12).text_color(t.muted).child(label))
    .child(Input.new(view.inputs[key]).accessibility_label(label).disabled(disabled).w_full().h(32).px(8)
      .rounded(6).border_1().border_color(t.border).bg(t.background).text_color(t.foreground));
  const machineValue = form.machine === undefined ? "focused" : form.machine === null ? "local" : "remote:" + form.machine;
  const paneOptions = [{ value: "", label: "Focused Pi pane on this host" }, ...piPanes(target.machine).map(p => ({
    value: p.terminal, label: (p.title || "Pi") + " · " + p.terminal,
  }))];
  if (form.terminal && !paneOptions.some(p => p.value === form.terminal))
    paneOptions.push({ value: form.terminal, label: form.terminal + " (unavailable on this host)", disabled: true });
  const errors = [...new Set([view.statusError, view.actionError, view.deviceError, view.storageError, view.status?.error].filter(Boolean))];
  const local = v_flex().w_full().max_w(360).min_w(0).gap(16)
    .child(div().font_semibold().child("Connection"))
    .child(choose("provider", Object.entries(PROVIDERS).map(([value, label]) => ({ value, label })), form.provider))
    .child(choose("machine", [{ value: "focused", label: "Follow focused machine" }, ...machines().map(m => ({
      value: m.name === null ? "local" : "remote:" + m.name,
      label: (m.name || "This computer") + (m.layout === "ready" ? "" : " (unavailable)"), disabled: m.layout !== "ready",
    }))], machineValue, next => next === "focused" ? undefined : next === "local" ? null : next.slice(7)))
    .child(choose("terminal", paneOptions, form.terminal))
    .child(h_flex().pt(6).items_center()
      .child(div().flex_1().font_semibold().child("Audio on this computer"))
      .child(iconButton("voice-devices", "search", "Refresh local audio devices", (_e, cx) => view.refresh(cx, true), busy || view.refreshing)))
    .child(devices("microphone"))
    .child(devices("speaker"))
    .child(textButton("voice-manual-toggle", view.manual ? "Hide manual connection" : "Manual connection",
      (_e, cx) => { view.manual = !view.manual; cx.notify(); }, disabled, view.manual))
    .when(view.manual, el => el
      .child(field("sshHost", "SSH host"))
      .child(field("url", "Server HTTPS URL"))
      .child(field("certificate", "Certificate PEM path"))
      .child(h_flex().justify_end().child(iconButton("voice-manual", "plug", "Connect to server URL", (_e, cx) => view.connect(cx), disabled || !view.status))))
    .children(errors.map(error => div().text_color(t.blocked).child(error)));
  const host = () => view.host.render(Boolean(view.pending) || active);
  const scroll = (id, child) => v_flex().id(id).h_full().min_h(0).min_w(0).overflow_y_scrollbar().child(child);
  const content = stacked || !view.advanced
    ? v_flex().id("voice-fields").flex_1().min_h(0).overflow_y_scrollbar().px(16).pb(16).gap(24).child(local)
      .when(view.advanced, el => el.child(v_flex().w_full().pt(20).border_t_1().border_color(t.border).child(host())))
    : h_flex().flex_1().min_h(0).px(16).pb(16).gap(24)
      .child(scroll("voice-local-fields", local).w(350).flex_none())
      .child(scroll("voice-host-fields", host()).flex_1().pl(24).border_l_1().border_color(t.border));
  return v_flex().id("voice-settings").size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(13)
    .on_size_change((size, cx) => { if (view.width !== size.width) { view.width = size.width; cx.notify(); } })
    .child(h_flex().flex_none().px(16).h(48).gap(8).items_center()
      .child(div().flex_1().font_semibold().child("Voice"))
      .child(div().text_size(12).text_color(t.muted).child(phase))
      .child(textButton("voice-advanced-toggle", view.advanced ? "Hide advanced" : "Advanced", (_e, cx) => { view.advanced = !view.advanced; cx.notify(); }, false, view.advanced))
      .when(!active, el => el
        .child(iconButton("voice-quick", "zap", "Quick connect voice", (_e, cx) => view.start(cx, true), busy || !view.status || !target.machineReady))
        .child(iconButton("voice-connect", "plug", "Connect to Pi pane", (_e, cx) => view.start(cx, false), busy || !view.status || !target.terminal)))
      .when(active, el => el
        .child(iconButton("voice-mute", view.status.muted ? "mic-off" : "mic", view.status.muted ? "Unmute voice" : "Mute voice",
          (_e, cx) => view.act("/mute", { muted: !view.status.muted }, cx), busy || !["listening", "muted"].includes(view.status.phase)))
        .child(iconButton("voice-disconnect", "disconnect", "Disconnect voice", (_e, cx) => view.act("/disconnect", {}, cx), busy)))
      .when(Boolean(view.overlay), el => el.child(iconButton("voice-close", "x", "Close voice settings", () => closeOverlay(view.overlay)))))
    .child(content);
}
