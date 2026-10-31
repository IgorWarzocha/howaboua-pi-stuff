import { div } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { theme, run } from "herdr";

export function renderSidebar({ status, phase, error, busy, onMute, onDisconnect }) {
  const t = theme();
  const active = status && ["connecting", "listening", "muted"].includes(status.phase);
  const button = (id, label, action, disabled = false) => Button.new(id)
    .accessibility_label(label).disabled(disabled).flex_1().px(8).py(6).rounded(5)
    .border_1().border_color(t.border).bg(t.raised)
    .text_color(disabled ? t.dim : t.foreground).on_click(action).child(label);
  const settings = () => run("mod.open", { name: "voice" });
  return v_flex().id("voice-sidebar").size_full().min_h(0).px(12).py(8).gap(6)
    .border_t_1().border_color(t.border).bg(t.chrome).text_color(t.foreground).text_size(12)
    .child(h_flex().items_center().justify_between()
      .child(Button.new("voice-settings").accessibility_label("Voice settings").py(2)
        .text_color(t.foreground).on_click(settings).child("Voice ▸"))
      .child(div().text_size(11).text_color(error ? t.blocked : t.muted).child(phase)))
    .child(h_flex().w_full().gap(6)
      .when(!active, (el) => el.child(button("voice-connect", "Connect…", settings)))
      .when(active, (el) => el
        .child(button("voice-mute", status.muted ? "Unmute" : "Mute", (_e, cx) => onMute(cx),
          busy || !["listening", "muted"].includes(status.phase)))
        .child(button("voice-disconnect", "Disconnect", (_e, cx) => onDisconnect(cx), busy))));
}
