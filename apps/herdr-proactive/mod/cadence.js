import { div } from "gpui-kit";
import { InputState, h_flex } from "gpui-base";
import { Choice } from "./select.js";
import { field } from "./ui.js";

const units = [{ value: 1, label: "Minutes" }, { value: 60, label: "Hours" }, { value: 1440, label: "Days" }];

// Keep arbitrary minute intervals exact, including values that are not whole hours.
export class Duration {
  constructor(id, minutes, cx) {
    this.unit = minutes % 60 === 0 ? 60 : 1;
    this.amount = InputState.new({ value: String(minutes / this.unit) });
    this.choice = new Choice(id + "-unit", "Unit", cx);
  }

  value(min, max) {
    const text = this.amount.value().trim();
    const minutes = Number(text) * this.unit;
    if (!text || !Number.isSafeInteger(minutes) || minutes < min || minutes > max)
      throw new Error("Choose a duration between " + (min === 1 ? "1 minute" : min + " minutes") + " and " + max / 1440 + " days, in whole minutes.");
    return minutes;
  }

  render(label, locked) {
    return h_flex().w_full().gap(12).items_end()
      .child(div().flex_1().min_w(0).child(field(this.amount, label, locked)))
      .child(div().w(120).flex_none().child(this.choice.render(units, this.unit,
        (value, cx) => { this.unit = value; cx.notify(); }, locked, false)));
  }
}
