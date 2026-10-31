import { div } from "gpui-kit";
import { v_flex, h_flex, Button, Select, Popup, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { theme } from "herdr";
import { icon } from "./ui.js";

export class Choice {
  constructor(id, label, cx) {
    this.id = id;
    this.label = label;
    this.open = false;
    this.highlight = 0;
    this.trigger = cx.focus_handle();
    this.list = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
  }

  render(options, value, change, disabled = false) {
    const t = theme();
    const selected = options.find(o => o.value === value);
    const choose = (index, cx) => {
      const option = options[index];
      if (!option || option.disabled) return;
      this.open = false;
      change(option.value, cx);
      this.trigger.focus();
      cx.notify();
    };
    const open = cx => {
      if (disabled) return;
      this.highlight = Math.max(0, options.findIndex(o => o.value === value && !o.disabled));
      this.open = true;
      this.list.focus();
      this.scroll.scroll_to_item(this.highlight);
      cx.notify();
    };
    const trigger = Button.new(this.id + "-trigger").accessibility_label(this.label)
      .disabled(disabled).track_focus(this.trigger).w_full().h(32).px(9).rounded(6)
      .border_1().border_color(t.border).bg(t.background).text_color(disabled ? t.dim : t.foreground)
      .on_click((_e, cx) => open(cx))
      .on_key_down((event, cx) => {
        if (["down", "up", "enter", "space"].includes(event.key)) { open(cx); cx.stop_propagation(); }
      })
      .child(h_flex().w_full().items_center().gap(8)
        .child(div().flex_1().truncate().child(selected?.label ?? "Unavailable"))
        .child(icon("chevron-down", 12)));
    const rows = v_virtual_list(this.id + "-list", options.length, 28, i => String(options[i].value), range =>
      options.slice(range.start, range.end).map((o, offset) => {
        const index = range.start + offset;
        return h_flex().id(this.id + "-" + index).items_center().role("list_box_option").aria_selected(o.value === value)
          .when(index === this.highlight, el => el.aria_active_descendant())
          .disabled(Boolean(o.disabled)).w_full().h(28).px(8).rounded(4).tooltip(o.label)
          .bg(index === this.highlight ? t.selected : t.popover).text_color(o.disabled ? t.dim : t.foreground)
          .when(!o.disabled, el => el.hover(s => s.bg(t.hover)))
          .child(h_flex().w_full().items_center().gap(8)
            .child(div().flex_1().truncate().child(o.label))
            .when(o.value === value, el => el.child(icon("check", 12))));
      }))
      .track_scroll(this.scroll).h(Math.min(224, options.length * 28)).w_full()
      .on_item_click((key, cx) => choose(options.findIndex(o => String(o.value) === key), cx));
    const list = v_flex().role("list_box").accessibility_label(this.label).track_focus(this.list).child(rows)
      .on_confirm((_e, cx) => choose(this.highlight, cx))
      .on_key_down((event, cx) => {
        if (event.key === "enter") { choose(this.highlight, cx); cx.stop_propagation(); return; }
        const step = event.key === "down" ? 1 : event.key === "up" ? -1 : 0;
        if (!step && event.key !== "home" && event.key !== "end") return;
        let next = event.key === "home" ? -1 : event.key === "end" ? options.length : this.highlight;
        const direction = step || (event.key === "home" ? 1 : -1);
        for (let i = 0; i < options.length; i++) {
          next = (next + direction + options.length) % options.length;
          if (!options[next].disabled) { this.highlight = next; break; }
        }
        this.scroll.scroll_to_item(this.highlight, "center");
        cx.stop_propagation(); cx.notify();
      });
    return v_flex().w_full().gap(5)
      .child(div().text_color(t.muted).text_size(12).child(this.label))
      .child(Select.new(this.id).accessibility_label(this.label).disabled(disabled)
        .open(this.open && !disabled).track_focus(this.trigger).content_focus_handle(this.list)
        .on_open_change((open, cx) => {
          this.open = open && !disabled;
          if (this.open) {
            this.highlight = Math.max(0, options.findIndex(o => o.value === value && !o.disabled));
            this.scroll.scroll_to_item(this.highlight);
          }
          cx.notify();
        })
        .child(Popup.new(this.id + "-popup", trigger).anchor("bottom_left")
          .when(this.open && !disabled, el => el.content(v_flex().relative().w(360).p(4).rounded(6)
            .border_1().border_color(t.border).bg(t.popover).child(list)
            .child(Scrollbar.vertical(this.id + "-list").absolute().inset_0())))));
  }
}
