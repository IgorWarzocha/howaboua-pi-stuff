import { svg } from "gpui-kit";
import { Button } from "gpui-base";
import { theme } from "herdr";

export function icon(name, size = 15) {
  const voice = ["zap", "plug", "mic", "mic-off", "disconnect"].includes(name);
  return svg(`mods/${voice ? "voice/icons" : "workspace-chrome"}/${name}.svg`).size(size).flex_none();
}

export function iconButton(id, name, label, action, disabled = false, selected = false) {
  const t = theme();
  return Button.new(id).accessibility_label(label).tooltip(label).disabled(disabled)
    .size(28).flex_none().flex().items_center().justify_center().rounded(6)
    .bg(selected ? t.selected : t.chrome).text_color(disabled ? t.dim : selected ? t.accent : t.muted)
    .when(!disabled, el => el.hover(s => s.bg(t.hover).text_color(t.foreground)))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(action).child(icon(name));
}

export function textButton(id, label, action, disabled = false, selected = false) {
  const t = theme();
  return Button.new(id).accessibility_label(label).disabled(disabled)
    .h(30).px(10).flex_none().rounded(6).border_1().border_color(t.border)
    .bg(selected ? t.selected : t.background).text_color(disabled ? t.dim : t.foreground)
    .when(!disabled, el => el.hover(s => s.bg(t.hover)))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(action).child(label);
}
