import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, closeOverlay } from "herdr";
import { connection, PROVIDERS, targets } from "./state.js";
import { iconButton, textButton, layoutWidth } from "./ui.js";

export function renderSettings(view) {
  const t = theme();
  const busy = Boolean(view.pending);
  const active = ["connecting", "listening", "muted"].includes(view.status?.phase);
  const form = connection();
  const target = targets();
  const devices = key => {
    const values = view.devices[key === "microphone" ? "microphones" : "speakers"];
    const options = [{ value: "", label: "System default" }, ...values.map(d => ({ value: d.name, label: d.description || d.name }))];
    if (form[key] && !values.some(d => d.name === form[key]))
      options.push({ value: form[key], label: form[key] + " (not in local list)", disabled: true });
    return view.choices[key].render(options, form[key], (next, cx) => { view.save(key, next); cx.notify(); }, busy || active);
  };
  const errors = [...new Set([view.statusError, view.actionError, view.deviceError, view.storageError, view.status?.error].filter(Boolean))];
  const local = v_flex().w_full().min_w(0).gap(12)
    .child(view.host.selectors())
    .child(view.choices.provider.render(Object.entries(PROVIDERS).map(([value, label]) => ({ value, label })), form.provider,
      (next, cx) => { view.save("provider", next); cx.notify(); }, busy || active))
    .child(h_flex().pt(6).items_center()
      .child(div().flex_1().font_semibold().child("Audio on this computer"))
      .child(iconButton("voice-devices", "search", "Refresh local audio devices", (_e, cx) => view.refresh(cx, true), busy || view.refreshing)))
    .child(devices("microphone"))
    .child(devices("speaker"))
    .children(errors.map(error => div().text_color(t.blocked).child(error)));
  const host = () => view.host.render();
  const scroll = (id, child) => v_flex().id(id).h_full().min_h(0).min_w(0).overflow_y_scrollbar().child(child);
  const content = layoutWidth(view.width) < 700
    ? v_flex().id("voice-fields").flex_1().min_h(0).overflow_y_scrollbar().px(16).pb(16).gap(24).child(local)
      .child(v_flex().w_full().pt(20).border_t_1().border_color(t.border).child(host()))
    : h_flex().flex_1().min_h(0).px(16).pb(16).gap(24)
      .child(scroll("voice-local-fields", local).w(310).flex_none())
      .child(scroll("voice-host-fields", host()).flex_1().pl(24).border_l_1().border_color(t.border));
  return v_flex().id("voice-settings").w_full().h(800).min_h(0).bg(t.chrome).text_color(t.foreground).text_size(13)
    .on_size_change((size, cx) => { if (view.width !== size.width) { view.width = size.width; cx.notify(); } })
    .child(h_flex().flex_none().px(16).h(48).gap(8).items_center()
      .child(div().flex_1().font_semibold().child("Voice settings"))
      .child(textButton("voice-settings-connect", view.pending ? "Connecting…" : "Connect to focused pane", (_e, cx) => view.start(cx, false),
        busy || Boolean(view.host.busy) || active || !view.status || !target.terminal)
        .tooltip(target.terminal || "Focus a live Pi pane to connect voice"))
      .when(Boolean(view.overlay), el => el.child(iconButton("voice-close", "x", "Close voice settings", () => closeOverlay(view.overlay)))))
    .child(content);
}
