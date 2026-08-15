#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readCoverage, readMissingCoverage } from "./refactor-coverage.mjs";

const HELP = `Compare a pre-refactor module with its replacement and report old-side coverage.

Usage:
  bun refactor:compare --entry <repo path> --probe <module> [options]

Options:
  --base <git ref>       old source revision (default: HEAD^)
  --after <module>       current replacement; defaults to --entry when it exists
  --min <percent>        require this percentage for lines, functions, branches, statements

The ESM probe exports default or compare(before, after?). Use .mts outside a type:module package.
It imports split replacements itself when --after is omitted, throws on mismatch, and may return
a case count or { cases: number }. The old entry runs against current dependencies, so use this for
extraction refactors where its imported dependencies did not change.
`;
try {
  await compareRefactor(process.argv.slice(2));
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
}

async function compareRefactor(argv) {
  const options = parseOptions(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!options.entry || !options.probe) fail("--entry and --probe are required");
  const root = gitRoot();
  const entry = repositoryPath(root, options.entry);
  const source = gitShow(root, options.base, entry.relative);
  const extension = extname(entry.absolute);
  const stem = basename(entry.absolute, extension);
  const snapshot = join(
    dirname(entry.absolute),
    `${stem}.refactor-before-${process.pid}${extension}`,
  );
  const coverageDirectory = mkdtempSync(join(tmpdir(), "pi-refactor-coverage-"));
  const probeResultPath = join(coverageDirectory, "probe-result.json");
  const probe = resolve(process.cwd(), options.probe);
  const after = options.after
    ? resolve(process.cwd(), options.after)
    : existsSync(entry.absolute)
      ? entry.absolute
      : undefined;
  try {
    writeFileSync(snapshot, source, { mode: 0o600, flag: "wx" });
    const require = createRequire(import.meta.url);
    const c8 = require.resolve("c8/bin/c8.js");
    const tsx = require.resolve("tsx/cli");
    const c8Args = [
      c8,
      "--reports-dir",
      coverageDirectory,
      "--temp-directory",
      join(coverageDirectory, "raw"),
      "--reporter",
      "json-summary",
      "--reporter",
      "json",
      "--include",
      relative(root, snapshot).replaceAll("\\", "/"),
      "--exclude-after-remap=false",
    ];
    if (options.min !== undefined) {
      c8Args.push(
        "--check-coverage",
        "--lines",
        String(options.min),
        "--functions",
        String(options.min),
        "--branches",
        String(options.min),
        "--statements",
        String(options.min),
      );
    }
    c8Args.push(
      process.execPath,
      tsx,
      join(dirname(import.meta.filename), "refactor-compare-runner.mjs"),
      "--before",
      snapshot,
      "--probe",
      probe,
      "--result",
      probeResultPath,
      ...(after ? ["--after", after] : []),
    );
    const run = spawnSync(process.execPath, c8Args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
    if (run.error) throw run.error;
    const probeResult = readProbeResult(probeResultPath);
    const coverage = readCoverage(join(coverageDirectory, "coverage-summary.json"));
    const missing = readMissingCoverage(join(coverageDirectory, "coverage-final.json"));
    const ok = run.status === 0 && probeResult !== undefined && coverage !== undefined;
    const diagnostic = ok ? undefined : boundedDiagnostic(run.stderr || run.stdout);
    console.log(
      JSON.stringify({
        ok,
        equivalent: probeResult !== undefined,
        ...(probeResult?.cases === undefined ? {} : { cases: probeResult.cases }),
        base: options.base,
        entry: entry.relative,
        ...(after ? { after: relative(root, after).replaceAll("\\", "/") } : {}),
        ...(options.min === undefined ? {} : { minimum: options.min }),
        ...(coverage ? { coverage } : {}),
        ...(missing ? { missing } : {}),
        ...(diagnostic ? { error: diagnostic } : {}),
      }),
    );
    if (!ok) process.exitCode = run.status || 1;
  } finally {
    rmSync(snapshot, { force: true });
    rmSync(coverageDirectory, { recursive: true, force: true });
  }
}

function parseOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      base: { type: "string", default: "HEAD^" },
      entry: { type: "string" },
      probe: { type: "string" },
      after: { type: "string" },
      min: { type: "string" },
    },
    strict: true,
  });
  if (values.help) return { help: true };
  const min = values.min === undefined ? undefined : Number(values.min);
  if (min !== undefined && (!Number.isFinite(min) || min < 0 || min > 100)) {
    fail("--min must be between 0 and 100");
  }
  return {
    base: values.base,
    entry: values.entry,
    probe: values.probe,
    after: values.after,
    min,
  };
}

function repositoryPath(root, value) {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const path = relative(root, absolute);
  if (!path || path === ".." || path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    fail("--entry must stay inside the repository");
  }
  return { absolute, relative: path.replaceAll("\\", "/") };
}

function gitRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (result.status !== 0) fail(result.stderr.trim() || "not inside a Git repository");
  return result.stdout.trim();
}

function gitShow(root, base, entry) {
  const result = spawnSync("git", ["show", `${base}:${entry}`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) fail(result.stderr.trim() || `could not read ${entry} at ${base}`);
  return result.stdout;
}

function readProbeResult(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function boundedDiagnostic(value) {
  const text = String(value ?? "").trim();
  return text ? text.slice(-16_384) : "probe or coverage command failed";
}

function fail(message) {
  throw new Error(message);
}
