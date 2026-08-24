type JsonRecord = Record<string, unknown>;

type Trace = {
  name?: string;
  status?: string;
  error?: string;
  result?: unknown;
};

type StoredRecord = {
  line: number;
  value: JsonRecord;
};

type Assessment = {
  marked: boolean;
  nonzero: boolean;
  outerTool: string;
  leaves: string[];
  error: string;
  source:
    | "notebook script"
    | "nested tool"
    | "direct tool"
    | "nonzero subprocess";
  exitCodes: number[];
};

export type Follow = {
  line: number;
  timestamp: string;
  label: string;
  status: "error" | "nonzero" | "ok" | "user";
};

export type Incident = Assessment & {
  path: string;
  line: number;
  timestamp: string;
  family: string;
  signature: string;
  recovery: string;
  follow: Follow[];
};

export type AuditSummary = {
  since: string;
  until: string;
  filesScanned: number;
  toolResults: number;
  markedIncidents: number;
  sessionsWithMarked: number;
  hiddenNested: number;
  unmarkedNonzero: number;
  malformedLines: number;
};

export async function auditSessions(
  sessionRoot: string,
  since: Date,
  until: Date,
  includeNonzero: boolean,
  visibleFollow: number,
): Promise<{ summary: AuditSummary; incidents: Incident[] }> {
  const files = await recentSessionFiles(sessionRoot, since);
  const incidents: Incident[] = [];
  let malformedLines = 0;
  let toolResults = 0;
  let sessionsWithMarked = 0;
  let hiddenNested = 0;
  let unmarkedNonzero = 0;

  for (const path of files) {
    const { records, malformed } = await readSession(path);
    malformedLines += malformed;
    const calls = toolCalls(records);
    let sessionMarked = false;

    for (let index = 0; index < records.length; index++) {
      const stored = records[index];
      const message = messageOf(stored.value);
      if (!message || message.role !== "toolResult") continue;
      const timestamp = recordTimestamp(stored.value, message);
      if (!timestamp || timestamp < since || timestamp > until) continue;
      toolResults++;

      const assessment = assess(message);
      if (assessment.nonzero && !assessment.marked) unmarkedNonzero++;
      if (!assessment.marked && !(includeNonzero && assessment.nonzero)) {
        continue;
      }
      if (assessment.marked) {
        sessionMarked = true;
        if (message.isError !== true && errorTraces(message).length > 0) {
          hiddenNested++;
        }
      }

      const code = calls.get(String(message.toolCallId ?? "")) ?? "";
      const normalizedError = normalizeError(assessment.error);
      const { follow, recovery } = traceRecovery(
        records,
        index,
        assessment,
        visibleFollow,
      );
      incidents.push({
        ...assessment,
        path,
        line: stored.line,
        timestamp: timestamp.toISOString(),
        family: familyOf(assessment, code),
        error: normalizedError,
        signature: `${assessment.leaves.join("+")}: ${normalizedError}`,
        recovery,
        follow,
      });
    }
    if (sessionMarked) sessionsWithMarked++;
  }

  const markedIncidents =
    incidents.filter((incident) => incident.marked).length;
  return {
    summary: {
      since: since.toISOString(),
      until: until.toISOString(),
      filesScanned: files.length,
      toolResults,
      markedIncidents,
      sessionsWithMarked,
      hiddenNested,
      unmarkedNonzero,
      malformedLines,
    },
    incidents,
  };
}

async function recentSessionFiles(
  root: string,
  since: Date,
): Promise<string[]> {
  const paths: string[] = [];
  async function walk(directory: string): Promise<void> {
    try {
      for await (const entry of Deno.readDir(directory)) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory) await walk(path);
        else if (entry.isFile && entry.name.endsWith(".jsonl")) {
          const stat = await Deno.stat(path);
          if (stat.mtime && stat.mtime >= since) paths.push(path);
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      throw error;
    }
  }
  await walk(root);
  return paths.sort();
}

async function readSession(
  path: string,
): Promise<{ records: StoredRecord[]; malformed: number }> {
  const records: StoredRecord[] = [];
  let malformed = 0;
  const lines = (await Deno.readTextFile(path)).split("\n");
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    try {
      records.push({ line: index + 1, value: JSON.parse(lines[index]) });
    } catch {
      malformed++;
    }
  }
  return { records, malformed };
}

function messageOf(record: JsonRecord): JsonRecord | undefined {
  return record.type === "message" && record.message &&
      typeof record.message === "object"
    ? record.message as JsonRecord
    : undefined;
}

function recordTimestamp(
  record: JsonRecord,
  message: JsonRecord,
): Date | undefined {
  const raw = record.timestamp ?? message.timestamp;
  if (typeof raw !== "string") return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toolCalls(records: StoredRecord[]): Map<string, string> {
  const calls = new Map<string, string>();
  for (const { value } of records) {
    const message = messageOf(value);
    if (
      !message || message.role !== "assistant" ||
      !Array.isArray(message.content)
    ) continue;
    for (const item of message.content) {
      if (!item || typeof item !== "object") continue;
      const call = item as JsonRecord;
      if (call.type !== "toolCall" || typeof call.id !== "string") continue;
      const args = call.arguments as JsonRecord | undefined;
      calls.set(call.id, typeof args?.code === "string" ? args.code : "");
    }
  }
  return calls;
}

function tracesOf(message: JsonRecord): Trace[] {
  const details = message.details as JsonRecord | undefined;
  return Array.isArray(details?.traces) ? details.traces as Trace[] : [];
}

function errorTraces(message: JsonRecord): Trace[] {
  return tracesOf(message).filter((trace) => trace.status === "error");
}

function traceExitCode(trace: Trace): number | undefined {
  if (!trace.result || typeof trace.result !== "object") return undefined;
  const result = trace.result as JsonRecord;
  const details = result.details && typeof result.details === "object"
    ? result.details as JsonRecord
    : result;
  return Number.isInteger(details.exit_code)
    ? details.exit_code as number
    : undefined;
}

function assess(message: JsonRecord): Assessment {
  const outerTool = typeof message.toolName === "string"
    ? message.toolName
    : "unknown";
  const failed = errorTraces(message);
  const nonzeroTraces = tracesOf(message).filter((trace) => {
    const code = traceExitCode(trace);
    return code !== undefined && code !== 0;
  });
  const marked = message.isError === true || failed.length > 0;
  const exitCodes = nonzeroTraces.map(traceExitCode).filter(
    (code): code is number => code !== undefined,
  );
  const details = message.details as JsonRecord | undefined;
  const content = Array.isArray(message.content)
    ? message.content.filter((item) =>
      item && typeof item === "object" && (item as JsonRecord).type === "text"
    ).map((item) => String((item as JsonRecord).text ?? "")).join("\n")
    : "";
  const error = !marked && exitCodes.length > 0
    ? `exit ${exitCodes.join("+")}`
    : failed[0]?.error ??
      (typeof details?.scriptError === "string"
        ? details.scriptError
        : content);
  const leaves = failed.length > 0
    ? [...new Set(failed.map((trace) => trace.name ?? outerTool))]
    : nonzeroTraces.length > 0 && !marked
    ? [...new Set(nonzeroTraces.map((trace) => trace.name ?? outerTool))]
    : [outerTool];
  const source = !marked
    ? "nonzero subprocess"
    : outerTool === "exec" && failed.length === 0 &&
        typeof details?.scriptError === "string"
    ? "notebook script"
    : failed.length > 0
    ? "nested tool"
    : "direct tool";
  return {
    marked,
    nonzero: nonzeroTraces.length > 0,
    outerTool,
    leaves,
    error,
    source,
    exitCodes,
  };
}

function familyOf(incident: Assessment, code: string): string {
  const first = normalizeError(incident.error);
  if (incident.source === "nonzero subprocess") return "subprocess/nonzero";
  if (incident.source !== "notebook script") {
    return `tool/${incident.leaves.join("+")}`;
  }
  if (
    first === "Error: Execution failed" && code.includes("String.raw`") &&
    code.includes("${")
  ) return "notebook/template-interpolation-candidate";
  if (/Identifier '.+' has already been declared/.test(first)) {
    return "notebook/persistent-binding";
  }
  if (/Cannot access '.+' before initialization/.test(first)) {
    return "notebook/global-shadowing";
  }
  if (/reading 'begin'/.test(first)) return "notebook/runtime-start";
  if (/Unknown custom tool|tools\..+ is not a function/.test(first)) {
    return "notebook/tool-name";
  }
  if (/SyntaxError/.test(first)) return "notebook/syntax";
  if (first === "Error: Execution failed") return "notebook/execution-failed";
  if (/still active/.test(first)) return "notebook/active-cell";
  return "notebook/script";
}

export function normalizeError(error: string): string {
  const home = Deno.env.get("HOME");
  let first = error.split("\n")[0] ?? "";
  if (home) first = first.replaceAll(home, "~");
  return first
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
    .replace(/call_[A-Za-z0-9|_-]+/g, "<call>")
    .replace(/notebook-\d+/g, "notebook-<n>")
    .replace(/:\d+:\d+/g, ":<line>")
    .replace(/\s+/g, " ")
    .slice(0, 220);
}

function traceRecovery(
  records: StoredRecord[],
  start: number,
  incident: Assessment,
  visibleLimit: number,
): { follow: Follow[]; recovery: string } {
  const follow: Follow[] = [];
  const targets = incident.source === "nested tool"
    ? incident.leaves
    : [incident.outerTool];
  let repeated = false;
  let otherSuccess = false;
  let userBoundary = false;
  let sameToolSuccess = false;
  let toolSteps = 0;

  for (
    let index = start + 1;
    index < records.length && toolSteps < 20;
    index++
  ) {
    const stored = records[index];
    const message = messageOf(stored.value);
    if (!message) continue;
    const timestamp = recordTimestamp(stored.value, message)?.toISOString() ??
      "unknown";
    if (message.role === "user") {
      userBoundary = true;
      if (follow.length < visibleLimit) {
        follow.push({
          line: stored.line,
          timestamp,
          label: "user boundary",
          status: "user",
        });
      }
      break;
    }
    if (message.role !== "toolResult") continue;
    toolSteps++;
    const next = assess(message);
    const status = next.marked ? "error" : next.nonzero ? "nonzero" : "ok";
    const label = `${next.outerTool}${
      next.leaves.some((leaf) => leaf !== next.outerTool)
        ? ` via ${next.leaves.join("+")}`
        : ""
    }`;
    if (follow.length < visibleLimit) {
      follow.push({ line: stored.line, timestamp, label, status });
    }

    const failedTools = next.marked ? next.leaves : [];
    const successfulTraces = tracesOf(message).filter((trace) =>
      trace.status === "done"
    ).map((trace) => trace.name ?? next.outerTool);
    const successfulTools = !next.marked && !next.nonzero
      ? [...new Set([next.outerTool, ...successfulTraces])]
      : [];
    if (failedTools.some((tool) => targets.includes(tool))) repeated = true;
    if (successfulTools.length > 0) {
      otherSuccess = true;
      if (successfulTools.some((tool) => targets.includes(tool))) {
        sameToolSuccess = true;
        break;
      }
    }
  }

  const recovery = sameToolSuccess
    ? "same-tool success"
    : userBoundary
    ? "user boundary"
    : repeated
    ? "repeated"
    : otherSuccess
    ? "other success"
    : "no follow-up";
  return { follow, recovery };
}
