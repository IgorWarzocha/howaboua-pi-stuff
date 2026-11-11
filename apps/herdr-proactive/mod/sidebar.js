import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, layout, openOverlay } from "herdr";
import { iconButton } from "./ui.js";

export function renderSidebar(view) {
  const t = theme();
  const find = node => node?.id === "sidebar" ? node : node?.children?.map(find).find(Boolean);
  const narrow = !view.toolbar && (find(layout())?.size?.px ?? 268) < 160;
  if (narrow) return h_flex().size_full().items_center().justify_center().bg(t.chrome)
    .child(iconButton("proactive-rail", "clock", "Proactive controls", () => openOverlay({
      mod: "proactive", props: { compact: true, toolbar: true, machine: view.machine, workspace: view.workspace },
      kind: "popup", width: 224, height: 42, at: "pointer",
    })));
  const rows = view.status?.policies.filter(p => p.space === view.workspace) ?? [];
  const recipients = rows.filter(p => p.terminal === view.target.terminal && p.enabled && p.allowTerminalInput && p.prompt.trim());
  const checkIn = recipients.length === 1 ? recipients[0] : null;
  const ready = view.status?.service.running;
  const label = view.error ? "Unavailable" : !view.status ? "Loading" : !ready ? "Background service stopped" :
    rows.some(p => p.enabled) ? "Check-ins on" : "Check-ins off";
  return h_flex().id("proactive-sidebar").size_full().min_w(0).px(8).gap(4).items_center()
    .border_t_1().border_color(t.border).bg(t.chrome).text_size(12)
    .child(div().flex_1().text_color(t.dim).tooltip(label).child("Proactive"))
    .child(iconButton("proactive-now", rows.length ? "target" : "plus", rows.length ?
      checkIn ? "Check in now · " + checkIn.name : "Focus an agent with check-ins enabled" : "Set up check-ins",
      (_e, cx) => rows.length ? view.act("run", { id: checkIn.id }, cx) : view.expand(true),
      Boolean(view.busy) || (rows.length > 0 && (!checkIn || !ready))))
    .child(iconButton("proactive-settings-open", "settings", "Proactive settings", () => view.expand()));
}
