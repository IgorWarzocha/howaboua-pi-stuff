#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    before: { type: "string" },
    probe: { type: "string" },
    after: { type: "string" },
    result: { type: "string" },
  },
  strict: true,
});
if (!values.before || !values.probe || !values.result) {
  throw new Error("probe runner requires --before, --probe, and --result");
}
const before = await import(pathToFileURL(values.before).href);
const after = values.after ? await import(pathToFileURL(values.after).href) : undefined;
const probe = await import(pathToFileURL(values.probe).href);
const compare = probe.compare ?? probe.default;
if (typeof compare !== "function") throw new Error("probe must export default or compare");
const outcome = await compare(before, after);
if (outcome === false) throw new Error("probe reported a mismatch");
const cases =
  typeof outcome === "number"
    ? outcome
    : outcome && typeof outcome === "object" && Number.isSafeInteger(outcome.cases)
      ? outcome.cases
      : undefined;
writeFileSync(values.result, JSON.stringify({ cases }), { mode: 0o600 });
