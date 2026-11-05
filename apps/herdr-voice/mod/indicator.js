// herdr-voice-managed-indicator v1
import { div, svg } from "gpui-kit";
import { shared, theme } from "herdr";

export function voiceActive(terminal) {
  return Boolean(terminal && shared("voice.activity")?.terminal === terminal);
}

export function voiceIndicator(terminal) {
  if (!voiceActive(terminal)) return div();
  const activity = shared("voice.activity");
  const t = theme();
  const label = activity.phase === "connecting" ? "Voice connecting" : activity.muted ? "Voice muted" : "Voice active";
  return div().id(`voice-${terminal}`).flex_none().flex().items_center()
    .accessibility_label(label).tooltip(label)
    .text_color(activity.muted ? t.ansi1 : activity.phase === "connecting" ? t.accent : t.ansi2)
    .child(svg(`mods/voice/icons/${activity.muted ? "mic-off" : "mic"}.svg`).size(13));
}
