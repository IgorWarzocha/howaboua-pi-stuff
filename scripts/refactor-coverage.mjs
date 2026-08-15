import { readFileSync } from "node:fs";

export function readCoverage(path) {
  try {
    const summary = JSON.parse(readFileSync(path, "utf8")).total;
    return Object.fromEntries(
      ["lines", "functions", "branches", "statements"].map((name) => [name, summary[name].pct]),
    );
  } catch {
    return undefined;
  }
}

export function readMissingCoverage(path) {
  try {
    const files = Object.values(JSON.parse(readFileSync(path, "utf8")));
    const lines = new Set();
    const functions = [];
    const branches = [];
    for (const file of files) {
      collectMissingLines(file, lines);
      collectMissingFunctions(file, functions);
      collectMissingBranches(file, branches);
    }
    return {
      lines: lineRanges([...lines].sort((left, right) => left - right)),
      functions: functions.sort((left, right) => left.line - right.line),
      branches: branches.sort((left, right) => left.line - right.line),
    };
  } catch {
    return undefined;
  }
}

function collectMissingLines(file, lines) {
  for (const [id, count] of Object.entries(file.s)) {
    if (count !== 0) continue;
    const location = file.statementMap[id];
    for (let line = location.start.line; line <= location.end.line; line += 1) lines.add(line);
  }
}

function collectMissingFunctions(file, functions) {
  for (const [id, count] of Object.entries(file.f)) {
    if (count !== 0) continue;
    const definition = file.fnMap[id];
    functions.push({ name: definition.name, line: definition.decl.start.line });
  }
}

function collectMissingBranches(file, branches) {
  for (const [id, counts] of Object.entries(file.b)) {
    const definition = file.branchMap[id];
    const paths = counts.flatMap((count, index) => (count === 0 ? [index] : []));
    if (paths.length === 0) continue;
    branches.push({
      line: definition.loc?.start.line ?? definition.line,
      type: definition.type,
      paths,
    });
  }
}

function lineRanges(lines) {
  const ranges = [];
  let start;
  let previous;
  for (const line of lines) {
    if (start === undefined) {
      start = previous = line;
    } else if (line === previous + 1) {
      previous = line;
    } else {
      ranges.push(start === previous ? String(start) : `${start}-${previous}`);
      start = previous = line;
    }
  }
  if (start !== undefined) ranges.push(start === previous ? String(start) : `${start}-${previous}`);
  return ranges;
}
