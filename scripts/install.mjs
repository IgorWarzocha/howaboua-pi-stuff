import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  readlinkSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { hookSnippet } from '../integrations/hooks.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const marker = '# installed by herdr-state';
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Arrays are hook lists: append only missing entries. Conflicting scalar schema
// versions are not safe to migrate, so reject the entire merge before writing.
export function mergeJson(existing, fragment) {
  if (!object(existing) || !object(fragment)) throw new Error('expected a JSON object');
  const merged = structuredClone(existing);
  for (const [key, value] of Object.entries(fragment)) {
    if (!Object.hasOwn(merged, key)) merged[key] = structuredClone(value);
    else if (Array.isArray(value) && Array.isArray(merged[key])) {
      for (const item of value) {
        if (!merged[key].some(old => isDeepStrictEqual(old, item))) merged[key].push(structuredClone(item));
      }
    } else if (object(value) && object(merged[key])) merged[key] = mergeJson(merged[key], value);
    else if (!isDeepStrictEqual(merged[key], value)) throw new Error(`incompatible existing value: ${key}`);
  }
  return merged;
}

function entry(path) {
  try { return lstatSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function atomicWrite(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.herdr-state-${randomUUID()}`);
  try {
    closeSync(openSync(temporary, 'wx', mode));
    writeFileSync(temporary, content);
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function mergeFile(path, fragment) {
  const info = entry(path);
  if (info && !info.isFile()) throw new Error(`preserved non-regular configuration: ${path}`);
  const current = info ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const next = mergeJson(current, fragment);
  if (isDeepStrictEqual(current, next)) return false;
  atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`, info ? info.mode & 0o7777 : 0o600);
  return true;
}

function link(source, target) {
  const info = entry(target);
  if (info) {
    if (info.isSymbolicLink() && resolve(dirname(target), readlinkSync(target)) === resolve(source)) return false;
    throw new Error(`preserved existing path: ${target}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(source, target);
  return true;
}

export function install({ home = homedir(), env = process.env, distribution = root } = {}) {
  if (process.platform === 'win32') throw new Error('installer requires a POSIX shell');
  home = resolve(home);
  distribution = resolve(distribution);
  env = { ...env, HOME: home };
  const report = { installed: [], skipped: [], warnings: [] };
  const run = (command, args) => spawnSync(command, args,
    { env, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true });
  const available = command => {
    const result = run(command, ['--version']);
    return !result.error && result.status === 0;
  };
  const skip = (agent, reason, warn = false) => {
    report.skipped.push({ agent, reason });
    if (warn) report.warnings.push(`${agent}: ${reason}`);
  };
  const perform = (agent, path, action) => {
    try { report.installed.push({ agent, path, changed: action() }); }
    catch (error) { skip(agent, error.message, true); }
  };
  const configured = (key, fallback) => env[key]
    ? resolve(env[key].replace(/^~(?=\/|$)/, home)) : join(home, fallback);
  const xdg = configured('XDG_CONFIG_HOME', '.config');

  const wrapper = join(home, '.local/bin/herdr-state');
  perform('cli', wrapper, () => {
    const content = `#!/bin/sh\n${marker}\nif [ "\${1-}" = capture ]; then\n  shift\n  exec ${quote(process.execPath)} ${quote(join(distribution, 'src/capture.mjs'))} "$@"\nfi\nexec ${quote(process.execPath)} ${quote(join(distribution, 'src/cli.mjs'))} "$@"\n`;
    const info = entry(wrapper);
    if (info && (!info.isFile() || !readFileSync(wrapper, 'utf8').split('\n').includes(marker))) {
      throw new Error(`preserved existing path: ${wrapper}`);
    }
    if (info && readFileSync(wrapper, 'utf8') === content && (info.mode & 0o111)) return false;
    atomicWrite(wrapper, content, 0o755);
    return true;
  });

  const piDir = configured('PI_CODING_AGENT_DIR', '.pi/agent');
  if (available('pi')) {
    const target = join(piDir, 'extensions/herdr-state.ts');
    perform('pi', target, () => link(join(distribution, 'integrations/pi.ts'), target));
  } else skip('pi', '--version failed or executable unavailable');

  if (available('omp')) {
    const ompDir = join(configured('PI_CONFIG_DIR', '.omp'), 'agent');
    if (env.PI_CODING_AGENT_DIR) skip('omp', 'PI_CODING_AGENT_DIR is shared with Pi; configure a separate OMP agent directory', true);
    else if (existsSync(ompDir) && !statSync(ompDir).isDirectory()) skip('omp', `agent path is not a directory: ${ompDir}`, true);
    else {
      const target = join(ompDir, 'extensions/herdr-state.ts');
      perform('omp', target, () => link(join(distribution, 'integrations/omp.ts'), target));
    }
  } else skip('omp', '--version failed or executable unavailable');

  const hooks = [
    ['claude', 'claude', join(configured('CLAUDE_CONFIG_DIR', '.claude'), 'settings.json')],
    ['codex', 'codex', join(configured('CODEX_HOME', '.codex'), 'hooks.json')],
    ['copilot', 'copilot', join(configured('COPILOT_HOME', '.copilot'), 'settings.json')],
    ['devin', 'devin', join(xdg, 'devin/config.json')],
    ['droid', 'droid', join(home, '.factory/settings.json')],
    ['mastracode', 'mastracode', join(home, '.mastracode/hooks.json')],
    ['qodercli', 'qodercli', join(configured('QODER_CONFIG_DIR', '.qoder'), 'settings.json')],
    ['qwen', 'qwen', join(configured('QWEN_HOME', '.qwen'), 'settings.json')],
    ['cursor', 'cursor-agent', join(configured('CURSOR_CONFIG_DIR', '.cursor'), 'hooks.json')],
    ['agy', 'agy', join(configured('ANTIGRAVITY_CLI_CONFIG_DIR', '.gemini/config'), 'hooks.json')],
    ['grok', 'grok', join(configured('GROK_HOME', '.grok'), 'hooks/herdr-state.json')],
    ['letta', 'letta', join(home, '.letta/settings.json')],
  ];
  for (const [agent, command, path] of hooks) {
    if (!available(command)) { skip(agent, '--version failed or executable unavailable'); continue; }
    if (agent === 'codex') {
      const features = run(command, ['features', 'list']);
      const enabled = !features.error && features.status === 0
        && features.stdout.match(/^hooks\s+.*\b(true|false)\s*$/m)?.[1];
      if (enabled !== 'true') {
        skip(agent, enabled === 'false'
          ? 'hooks feature is disabled; config.toml is preserved, enable it manually'
          : 'hooks feature is not advertised by codex features list', true);
        continue;
      }
    }
    if (agent === 'codex' && entry(path)?.isSymbolicLink()) {
      perform(agent, path, () => {
        const config = JSON.parse(readFileSync(path, 'utf8'));
        const command = 'if [ -n "${HC_TERMINAL_ID:-}" ]; then "$HOME/.local/bin/herdr-state" capture codex; fi';
        const registered = config.hooks?.SessionStart?.some(group => group.hooks?.some(hook => hook.type === 'command' && hook.command === command));
        if (!registered) throw new Error(`preserved shared hook configuration: ${path}; register herdr-state capture codex in its owning source`);
        return false;
      });
      continue;
    }
    perform(agent, path, () => mergeFile(path,
      hookSnippet(agent, process.execPath, join(distribution, 'src/capture.mjs'))));
  }

  for (const agent of ['opencode', 'kilo']) {
    if (!available(agent)) { skip(agent, '--version failed or executable unavailable'); continue; }
    const dir = agent === 'opencode'
      ? (env.OPENCODE_CONFIG_DIR ? configured('OPENCODE_CONFIG_DIR', '') : join(xdg, 'opencode'))
      : join(xdg, 'kilo');
    const target = join(dir, 'plugin/herdr-state.js');
    perform(agent, target, () => link(join(distribution, `integrations/${agent}.mjs`), target));
    report.warnings.push(agent === 'opencode'
      ? 'opencode: capture supports local run/Mini, not full TUI, shared servers or attach; no reload performed'
      : 'kilo: capture begins with a native chat.message event; no reload performed');
  }
  if (available('kimi')) {
    const path = join(home, '.kimi-code/config.toml');
    perform('kimi', path, () => {
      const info = entry(path);
      if (info && !info.isFile()) throw new Error(`preserved non-regular configuration: ${path}`);
      const current = info ? readFileSync(path, 'utf8') : '';
      const parse = text => {
        const result = spawnSync('python3', ['-c', 'import sys,json,tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))'],
          { env, input: text, encoding: 'utf8', timeout: 5000 });
        if (result.error || result.status !== 0) throw new Error('TOML hooks require manual installation: Python 3.11+ tomllib is unavailable or config is invalid');
        return JSON.parse(result.stdout);
      };
      const fragment = hookSnippet('kimi', process.execPath, join(distribution, 'src/capture.mjs'));
      const existing = parse(current).hooks || [];
      if (!Array.isArray(existing)) throw new Error('preserved incompatible Kimi hooks table');
      const hook = parse(fragment).hooks[0];
      if (existing.some(item => isDeepStrictEqual(item, hook))) return false;
      const next = current + '\n' + fragment;
      parse(next);
      atomicWrite(path, next, info ? info.mode & 0o7777 : 0o600);
      return true;
    });
  } else skip('kimi', '--version failed or executable unavailable');
  if (available('hermes')) skip('hermes', 'YAML plugin activation requires manual installation; no safe parser is bundled', true);
  else skip('hermes', '--version failed or executable unavailable');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--home')) throw new Error('usage: node scripts/install.mjs [--home <path>]');
    console.log(JSON.stringify(install({ home: args[1] || homedir() }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
