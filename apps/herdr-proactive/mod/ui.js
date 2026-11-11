import { div, svg } from "gpui-kit";
import { Button, Checkbox, Input, Textarea, v_flex, h_flex } from "gpui-base";
import { theme, settings } from "herdr";

export function layoutScale() { return settings().zoom || 1; }
export function layoutWidth(width) { return width / layoutScale(); }
export function icon(name, size = 15) {
  return svg("mods/proactive/icons/" + name + ".svg").size(size).flex_none();
}
export function iconButton(id, name, label, action, disabled = false, selected = false) {
  const t = theme();
  return Button.new(id).accessibility_label(label).tooltip(label).disabled(disabled)
    .size(28).flex_none().flex().items_center().justify_center().rounded(6)
    .bg(selected ? t.selected : t.chrome).text_color(disabled ? t.dim : selected ? t.accent : t.muted)
    .when(!disabled, el => el.hover(s => s.bg(t.hover).text_color(t.foreground)))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(icon(name));
}
export function field(state, label, disabled = false, multiline = false) {
  const t = theme();
  return v_flex().w_full().gap(4)
    .child(div().text_size(12).text_color(t.muted).child(label))
    .child((multiline ? Textarea.new(state) : Input.new(state)).accessibility_label(label).disabled(disabled).w_full().h(multiline ? 100 : 34).px(8)
      .rounded(6).border_1().border_color(t.input).bg(t.background).text_color(t.foreground));
}
export function check(id, label, value, change, disabled = false) {
  const t = theme();
  return Checkbox.new(id).accessibility_label(label).checked(value).disabled(disabled)
    .max_w_full().min_w(0).on_change(change).child(h_flex().min_w(0).gap(8).items_start()
      .child(div().size(17).flex_none().border_1().border_color(t.input).rounded(3).bg(t.background)
        .when(value, el => el.child(icon("check", 15))))
      .child(div().flex_1().min_w(0).whitespace_normal().child(label)));
}
export function heading(title, actions = []) {
  return h_flex().gap(4).min_w(0).items_center().child(div().flex_1().min_w(0).font_semibold().child(title)).children(actions);
}
export function muted(text) { return div().text_size(12).text_color(theme().muted).child(text); }
export function instructionFile(path) { return muted(path).w_full().truncate().tooltip(path); }
export function errorText(text) { return div().text_color(theme().blocked).child(text); }
export function section() { return v_flex().w_full().min_w(0).gap(12); }
