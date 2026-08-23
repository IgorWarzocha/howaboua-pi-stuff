import {
  type AuditSummary,
  type Incident,
  normalizeError,
} from "./session-tool-errors.ts";

export type ReportOptions = {
  includeNonzero: boolean;
  details: number;
  clusters: number;
};

export function markdownReport(
  summary: AuditSummary,
  selected: Incident[],
  options: ReportOptions,
): string {
  const marked = selected.filter((incident) => incident.marked);
  const families = grouped(marked, (incident) => incident.family);
  const signatures = grouped(selected, (incident) => incident.signature);
  const recovery = grouped(marked, (incident) => incident.recovery);
  const lines = [
    "# Pi tool error audit",
    "",
    `Window: ${summary.since} to ${summary.until}`,
    `Scanned ${summary.filesScanned} session files and ${summary.toolResults} tool results.`,
    "",
    "## Summary",
    "",
    `- ${summary.markedIncidents} marked incidents across ${summary.sessionsWithMarked} sessions`,
    `- ${selected.length} incidents in the current selection`,
    `- ${summary.hiddenNested} nested failures persisted under a non-error outer result`,
    `- ${summary.unmarkedNonzero} unmarked nonzero subprocess results${
      options.includeNonzero
        ? " included"
        : " excluded; use --include-nonzero to inspect"
    }`,
    `- ${summary.malformedLines} malformed JSONL lines`,
    "",
    "### Families",
    "",
    "| Family | Count |",
    "| --- | ---: |",
    ...families.map(([name, rows]) =>
      `| ${escapeCell(name)} | ${rows.length} |`
    ),
    "",
    "### Recovery evidence",
    "",
    "| Observed chain | Count |",
    "| --- | ---: |",
    ...recovery.map(([name, rows]) =>
      `| ${escapeCell(name)} | ${rows.length} |`
    ),
    "",
    "## Signature clusters",
    "",
    "| Count | Recovery | Signature | Latest sample |",
    "| ---: | --- | --- | --- |",
  ];

  for (const [signature, rows] of signatures.slice(0, options.clusters)) {
    const latest = [...rows].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    )[0];
    const recoveries = grouped(
      rows.filter((row) => row.marked),
      (row) => row.recovery,
    ).map(([name, group]) => `${name} ${group.length}`).join(", ");
    lines.push(
      `| ${rows.length} | ${escapeCell(recoveries || "nonzero")} | ${
        escapeCell(signature)
      } | ${escapeCell(shortPath(latest.path))}:${latest.line} |`,
    );
  }

  lines.push("", "## Recent incident chains", "");
  for (
    const incident of [...selected].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    ).slice(0, options.details)
  ) {
    lines.push(
      `### ${incident.timestamp} · ${incident.family}`,
      "",
      `\`${shortPath(incident.path)}:${incident.line}\``,
      "",
      `${incident.source}; ${incident.outerTool}${
        incident.leaves.some((leaf) => leaf !== incident.outerTool)
          ? ` via ${incident.leaves.join("+")}`
          : ""
      }; ${incident.recovery}`,
      "",
      `> ${
        normalizeError(incident.error) ||
        `(exit ${incident.exitCodes.join(", ")})`
      }`,
      "",
    );
    for (const next of incident.follow) {
      lines.push(
        `- ${next.timestamp} line ${next.line}: ${next.label} · ${next.status}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

function grouped<T>(
  items: T[],
  key: (item: T) => string,
): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return [...groups].sort((a, b) =>
    b[1].length - a[1].length || a[0].localeCompare(b[0])
  );
}

function shortPath(path: string): string {
  const home = Deno.env.get("HOME");
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
