import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, closeOverlay } from "herdr";
import { connection, PROVIDERS } from "./state.js";
import { iconButton, textButton } from "./ui.js";

export function renderSettings(view) {
  const t = theme();
  const busy = Boolean(view.pending);
  const active = ["connecting", "listening", "muted"].includes(view.status?.phase);
  const form = connection();
  const devices = key => {
    const values = view.devices[key === "microphone" ? "microphones" : "speakers"];
    const options = [{ value: "", label: "System default" }, ...values.map(d => ({ value: d.name, label: d.description || d.name }))];
    if (form[key] && !values.some(d => d.name === form[key]))
      options.push({ value: form[key], label: form[key] + " (not in local list)", disabled: true });
    return view.choices[key].render(options, form[key], (next, cx) => { view.save(key, next); cx.notify(); }, busy || active);
  };
  const errors = [...new Set([view.statusError, view.deviceError, view.storageError].filter(Boolean))];
  const local = v_flex().w_full().max_w(360).min_w(0).gap(16)
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
  const content = view.width < 700 || !view.advanced
    ? v_flex().id("voice-fields").flex_1().min_h(0).overflow_y_scrollbar().px(16).pb(16).gap(24).child(local)
      .when(view.advanced, el => el.child(v_flex().w_full().pt(20).border_t_1().border_color(t.border).child(host())))
    : h_flex().flex_1().min_h(0).px(16).pb(16).gap(24)
      .child(scroll("voice-local-fields", local).w(310).flex_none())
      .child(scroll("voice-host-fields", host()).flex_1().pl(24).border_l_1().border_color(t.border));
  return v_flex().id("voice-settings").size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(13)
    .on_size_change((size, cx) => { if (view.width !== size.width) { view.width = size.width; cx.notify(); } })
    .child(h_flex().flex_none().px(16).h(48).gap(8).items_center()
      .child(div().flex_1().font_semibold().child("Voice settings"))
      .child(textButton("voice-advanced-toggle", view.advanced ? "Hide advanced" : "Advanced", (_e, cx) => { view.advanced = !view.advanced; cx.notify(); }, false, view.advanced))
      .when(Boolean(view.overlay), el => el.child(iconButton("voice-close", "x", "Close voice settings", () => closeOverlay(view.overlay)))))
    .child(content);
}
