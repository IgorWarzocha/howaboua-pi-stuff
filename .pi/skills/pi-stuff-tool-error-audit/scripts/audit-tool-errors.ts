import { auditSessions } from "./session-tool-errors.ts";
import { markdownReport } from "./tool-error-report.ts";

type Options = {
  since?: string;
  until?: string;
  tool?: string;
  family?: string;
  signature?: string;
  session?: string;
  includeNonzero: boolean;
  markChecked: boolean;
  json: boolean;
  details: number;
  clusters: number;
  follow: number;
};

const scriptDir = new URL(".", import.meta.url);
const stateUrl = new URL("../state.json", scriptDir);
const options = parseArgs(Deno.args);
const state = await readState();
const auditStartedAt = new Date();
const until = options.until
  ? parseTime(options.until, auditStartedAt)
  : auditStartedAt;
const since = options.since
  ? parseTime(options.since, until)
  : state.lastCheckedAt
  ? new Date(state.lastCheckedAt)
  : new Date(until.getTime() - 14 * 86_400_000);

if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
  throw new Error("Audit cursor contains an invalid timestamp");
}
if (until > auditStartedAt) {
  throw new Error("Audit end cannot be in the future");
}
if (!(since < until)) {
  throw new Error(
    `Audit start must precede end: ${since.toISOString()} >= ${until.toISOString()}`,
  );
}
if (
  options.markChecked &&
  (
    options.since ||
    options.until ||
    options.tool ||
    options.family ||
    options.signature ||
    options.session
  )
) {
  throw new Error("--mark-checked requires the complete default cursor window");
}

const home = Deno.env.get("HOME");
const agentDir = Deno.env.get("PI_CODING_AGENT_DIR") ??
  (home ? `${home}/.pi/agent` : undefined);
if (!agentDir) throw new Error("Set PI_CODING_AGENT_DIR or HOME");

const { summary, incidents } = await auditSessions(
  `${agentDir}/sessions`,
  since,
  until,
  options.includeNonzero,
  options.follow,
);
const filtered = incidents.filter((incident) => {
  if (
    options.tool &&
    ![incident.outerTool, ...incident.leaves].some((tool) =>
      tool.includes(options.tool!)
    )
  ) return false;
  if (options.family && !incident.family.includes(options.family)) return false;
  if (
    options.signature &&
    !`${incident.family} ${incident.signature}`.toLowerCase().includes(
      options.signature.toLowerCase(),
    )
  ) return false;
  if (options.session && !incident.path.includes(options.session)) return false;
  return true;
});

if (options.json) {
  console.log(JSON.stringify({ summary, incidents: filtered }, null, 2));
} else {
  console.log(markdownReport(summary, filtered, options));
}

if (options.markChecked) {
  if (summary.malformedLines > 0) {
    throw new Error(
      `Cannot mark audit window: found ${summary.malformedLines} malformed JSONL line(s)`,
    );
  }
  await Deno.writeTextFile(
    stateUrl,
    `${
      JSON.stringify(
        { version: 1, lastCheckedAt: until.toISOString(), lastWindow: summary },
        null,
        "\t",
      )
    }\n`,
  );
}

function parseArgs(args: string[]): Options {
  const parsed: Options = {
    includeNonzero: false,
    markChecked: false,
    json: false,
    details: 30,
    clusters: 30,
    follow: 6,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--include-nonzero") parsed.includeNonzero = true;
    else if (arg === "--mark-checked") parsed.markChecked = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--help") {
      console.log(
        "audit-tool-errors.ts [--since 14d|ISO] [--until ISO] [--tool NAME] [--family TEXT] [--signature TEXT] [--session TEXT] [--include-nonzero] [--details N|all] [--clusters N|all] [--follow N] [--json] [--mark-checked]",
      );
      Deno.exit(0);
    } else if (
      [
        "--since",
        "--until",
        "--tool",
        "--family",
        "--signature",
        "--session",
        "--details",
        "--clusters",
        "--follow",
      ].includes(arg)
    ) {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      if (arg === "--since") parsed.since = value;
      else if (arg === "--until") parsed.until = value;
      else if (arg === "--tool") parsed.tool = value;
      else if (arg === "--family") parsed.family = value;
      else if (arg === "--signature") parsed.signature = value;
      else if (arg === "--session") parsed.session = value;
      else if (arg === "--details") parsed.details = limit(value);
      else if (arg === "--clusters") parsed.clusters = limit(value);
      else parsed.follow = limit(value);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function limit(value: string): number {
  if (value === "all") return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer or all, got ${value}`);
  }
  return parsed;
}

function parseTime(value: string, anchor: Date): Date {
  const duration = /^(\d+)([dhm])$/.exec(value);
  if (duration) {
    const unit = duration[2] === "d"
      ? 86_400_000
      : duration[2] === "h"
      ? 3_600_000
      : 60_000;
    return new Date(anchor.getTime() - Number(duration[1]) * unit);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid time: ${value}`);
  return parsed;
}

async function readState(): Promise<{ lastCheckedAt: string | null }> {
  try {
    return JSON.parse(await Deno.readTextFile(stateUrl));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return { lastCheckedAt: null };
    throw error;
  }
}
