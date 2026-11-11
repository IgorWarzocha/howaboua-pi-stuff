import { div } from "gpui-kit";
import { TextareaState } from "gpui-base";
import { section, heading, field, check, muted } from "./ui.js";
import { durationLabel, scheduleLabel } from "./state.js";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const checkInFields = { name: "Name", terminal: "Agent", prompt: "Instructions", mode: "Timing", minMinutes: "Wait between check-ins",
  quietStart: "Quiet hours start (UTC)", quietEnd: "Quiet hours end (UTC)", enabled: "Active", allowTerminalInput: "Sending permission" };
const automationFields = { name: "Name", prompt: "Instructions", schedule: "Schedule", enabled: "Active" };

// Metadata and untouched definitions always come from the latest file snapshot.
// Only explicit field choices can replace conflicting edits made on disk.
export class EditConflict {
  constructor(base, mine, latest, automation, status) {
    this.result = { ...latest };
    this.conflicts = [];
    for (const [key, label] of Object.entries(automation ? automationFields : checkInFields)) {
      if (same(mine[key], base?.[key])) continue;
      if (base && !same(latest[key], base[key]) && !same(latest[key], mine[key])) {
        const describe = value => {
          if (key === "terminal") return status.terminals.find(t => t.address === value)?.name || "Previous agent";
          if (key === "schedule") return scheduleLabel(value);
          if (key === "minMinutes") return durationLabel(value);
          if (key === "quietStart" || key === "quietEnd") return String(value).padStart(2, "0") + ":00";
          if (key === "mode") return { adaptive: "Match my activity", fixed: "At a regular interval", off: "Only when asked" }[value];
          return typeof value === "boolean" ? value ? "On" : "Off" : String(value);
        };
        this.conflicts.push({ key, label, mine: mine[key], useMine: false,
          fileText: TextareaState.new({ value: describe(latest[key]), rows: 3 }),
          draftText: TextareaState.new({ value: describe(mine[key]), rows: 3 }) });
      } else this.result[key] = mine[key];
    }
  }

  value() {
    const value = { ...this.result };
    for (const item of this.conflicts) if (item.useMine) value[item.key] = item.mine;
    return value;
  }

  render() {
    return section().child(div().child(this.conflicts.length ?
      "The file changed. Choose which version to keep." : "Your edits can be combined with the updated file."))
      .children(this.conflicts.map(item => section().child(heading(item.label))
        .child(field(item.fileText, "In the file", true, true))
        .child(field(item.draftText, "Your draft", true, true))
        .child(check("merge-" + item.key, "Use my version", item.useMine, (value, cx) => { item.useMine = value; cx.notify(); }))))
      .child(muted("Nothing is saved until you review the combined draft and save it."));
  }
}
