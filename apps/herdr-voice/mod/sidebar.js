import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, layout, openOverlay } from "herdr";
import { iconButton } from "./ui.js";

export function renderSidebar({ status, phase, error, busy, target, expanded, onQuick, onConnect, onMute, onDisconnect }) {
  const t = theme();
  const active = status && ["connecting", "listening", "muted"].includes(status.phase);
  const find = node => node?.id === "sidebar" ? node : node?.children?.map(find).find(Boolean);
  const narrow = !expanded && (find(layout())?.size?.px ?? 268) < 160;
  if (narrow) return h_flex().size_full().items_center().justify_center().bg(t.chrome)
    .child(iconButton("voice-rail", active ? status.muted ? "mic-off" : "mic" : "plug", "Voice controls",
      () => openOverlay({ mod: "voice", props: { compact: true, toolbar: true }, kind: "popup", width: 228, height: 44, at: "pointer" })));
  return h_flex().id("voice-sidebar").size_full().min_w(0).px(8).gap(4).items_center()
    .border_t_1().border_color(t.border).bg(t.chrome)
    .when(!narrow, el => el
      .child(div().flex_1().text_size(12).text_color(t.dim).tooltip(error || phase).child("Voice"))
      .child(iconButton("voice-quick", "zap", `Quick connect · new Pi on ${target.machine || "this computer"}`,
        (_e, cx) => onQuick(cx), busy || active || !status || !target.machineReady))
      .child(iconButton("voice-connect", active ? "disconnect" : "plug",
        active ? "Disconnect voice" : target.terminal ? `Connect voice · ${target.terminal}` : "Focus a Pi pane to connect voice",
        (_e, cx) => active ? onDisconnect(cx) : onConnect(cx), busy || !status || (!active && !target.terminal))))
    .when(active, el => el.child(iconButton("voice-mute", status.muted ? "mic-off" : "mic",
      status.muted ? "Unmute microphone" : "Mute microphone", (_e, cx) => onMute(cx),
      busy || !["listening", "muted"].includes(status.phase), !status.muted)))
    .child(iconButton("voice-settings", error ? "alert-triangle" : "settings", error ? "Voice settings: " + error : "Voice settings", () => run("mod.open", { name: "voice" }))
      .when(Boolean(error), el => el.text_color(t.blocked)));
}
