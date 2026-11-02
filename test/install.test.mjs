import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync,
  readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install, mergeJson } from '../scripts/install.mjs';

const distribution = fileURLToPath(new URL('..', import.meta.url));

function fixture(t, commands = {}) {
  const home = mkdtempSync(join(tmpdir(), 'herdr-install-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, 'fake-bin');
  mkdirSync(bin);
  for (const [command, behavior] of Object.entries(commands)) {
    const source = typeof behavior === 'number' ? `process.exit(${behavior});` : behavior;
    writeFileSync(join(bin, command), `#!${process.execPath}\n${source}\n`, { mode: 0o755 });
  }
  const env = { HOME: home, PATH: bin };
  const put = (relative, value) => {
    const path = join(home, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
    return path;
  };
  return { home, env, put, run: overrides => install({ home, env, ...overrides }) };
}

test('JSON hook merge is immutable, lossless and rejects schema conflicts', () => {
  const current = { theme: 'dark', hooks: { Stop: [{ command: 'user-stop' }],
    SessionStart: [{ hooks: [{ command: 'user-start' }] }] } };
  const fragment = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'capture' }] }] } };
  const next = mergeJson(current, fragment);
  assert.deepEqual(next.hooks.Stop, current.hooks.Stop);
  assert.equal(next.theme, 'dark');
  assert.equal(current.hooks.SessionStart.length, 1);
  assert.equal(next.hooks.SessionStart.length, 2);
  assert.deepEqual(mergeJson(next, fragment), next);
  assert.throws(() => mergeJson({ hooks: [] }, fragment), /incompatible/);
  assert.throws(() => mergeJson({ version: 2 }, { version: 1 }), /incompatible/);
  assert.throws(() => mergeJson(null, fragment), /JSON object/);
});

test('isolated installation preserves settings and mode, rejects broken shims, and is idempotent', t => {
  const f = fixture(t, { pi: 0, claude: 0, qwen: 2, opencode: 0, kilo: 0 });
  const settings = f.put('.claude/settings.json', { theme: 'dark', hooks: {
    Stop: [{ command: 'user-stop' }], SessionStart: [{ hooks: [{ command: 'user-start' }] }],
  } });
  chmodSync(settings, 0o640);
  const first = f.run();
  assert.equal(first.installed.some(item => item.agent === 'cli'), true);
  assert.equal(first.installed.some(item => item.agent === 'pi'), true);
  assert.equal(first.installed.some(item => item.agent === 'qwen'), false);
  assert.equal(existsSync(join(f.home, '.qwen')), false);
  assert.equal(first.warnings.some(value => /full TUI/.test(value)), true);
  const merged = JSON.parse(readFileSync(settings, 'utf8'));
  assert.deepEqual(merged.hooks.Stop, [{ command: 'user-stop' }]);
  assert.equal(merged.hooks.SessionStart.length, 2);
  assert.equal(merged.theme, 'dark');
  assert.equal(statSync(settings).mode & 0o777, 0o640);
  const target = join(f.home, '.pi/agent/extensions/herdr-state.ts');
  assert.equal(readlinkSync(target), join(distribution, 'integrations/pi.ts'));
  assert.equal(readlinkSync(join(f.home, '.config/kilo/plugin/herdr-state.js')),
    join(distribution, 'integrations/kilo.mjs'));
  assert.equal(readlinkSync(join(f.home, '.config/opencode/plugin/herdr-state.js')),
    join(distribution, 'integrations/opencode.mjs'));
  const wrapper = readFileSync(join(f.home, '.local/bin/herdr-state'), 'utf8');
  assert.ok(wrapper.includes(process.execPath));
  assert.ok(wrapper.includes(join(distribution, 'src/cli.mjs')));
  assert.ok(wrapper.includes('"$@"'));
  const capture = spawnSync(join(f.home, '.local/bin/herdr-state'), ['capture', 'codex'], { env: f.env, encoding: 'utf8' });
  assert.equal(capture.status, 0, capture.stderr);
  assert.equal(capture.stdout, '');
  const mtime = statSync(settings).mtimeMs;
  const second = f.run();
  assert.equal(second.installed.every(item => item.changed === false), true);
  assert.equal(statSync(settings).mtimeMs, mtime);
  assert.equal(readdirSync(dirname(settings)).some(name => name.startsWith('.herdr-state-')), false);
});

test('unowned files, symlinks, malformed JSON and unsupported versions remain untouched', t => {
  const f = fixture(t, { pi: 0, claude: 0, cursor: 0, 'cursor-agent': 0, droid: 0 });
  const wrapper = f.put('.local/bin/herdr-state', '#!/bin/sh\necho user\n');
  const source = f.put('user-settings.json', { user: true });
  const settings = join(f.home, '.claude/settings.json');
  mkdirSync(dirname(settings), { recursive: true });
  symlinkSync(source, settings);
  const pi = f.put('.pi/agent/extensions/herdr-state.ts', '// user extension');
  const cursor = f.put('.cursor/hooks.json', { version: 2, user: true });
  const droid = f.put('.factory/settings.json', '{ broken');
  const before = [wrapper, source, pi, cursor, droid].map(path => readFileSync(path, 'utf8'));
  const report = f.run();
  assert.deepEqual([wrapper, source, pi, cursor, droid].map(path => readFileSync(path, 'utf8')), before);
  assert.equal(lstatSync(settings).isSymbolicLink(), true);
  for (const agent of ['cli', 'pi', 'claude', 'cursor', 'droid']) {
    assert.equal(report.skipped.some(item => item.agent === agent), true, agent);
  }
});

test('custom Pi home and OMP own-directory restriction prevent cross-loading', t => {
  const f = fixture(t, { pi: 0, omp: 0 });
  f.env.PI_CODING_AGENT_DIR = join(f.home, 'custom-pi');
  f.put('.omp/agent/session-placeholder', '');
  const custom = f.run();
  assert.equal(existsSync(join(f.home, 'custom-pi/extensions/herdr-state.ts')), true);
  assert.equal(existsSync(join(f.home, '.omp/agent/extensions/herdr-state.ts')), false);
  assert.equal(custom.warnings.some(value => /shared with Pi/.test(value)), true);
  delete f.env.PI_CODING_AGENT_DIR;
  const own = f.run();
  assert.equal(own.installed.some(item => item.agent === 'omp'), true);
  assert.equal(readlinkSync(join(f.home, '.omp/agent/extensions/herdr-state.ts')),
    join(distribution, 'integrations/omp.ts'));
  rmSync(join(f.home, '.omp'), { recursive: true });
  assert.equal(f.run().installed.some(item => item.agent === 'omp'), true);
  rmSync(join(f.home, '.omp'), { recursive: true });
  writeFileSync(join(f.home, '.omp'), 'user file');
  assert.equal(f.run().skipped.some(item => item.agent === 'omp'), true);
});

test('Codex requires advertised enabled hooks and never rewrites TOML; other parserless agents are manual', t => {
  const behavior = 'if (process.argv[2] === "features") console.log(process.env.FEATURES); process.exit(0);';
  const f = fixture(t, { codex: behavior, kimi: 0, hermes: 0 });
  const config = f.put('.codex/config.toml', '[features]\nhooks = false # user choice\n');
  f.env.FEATURES = 'other stable true';
  assert.equal(f.run().warnings.some(value => /not advertised/.test(value)), true);
  f.env.FEATURES = 'hooks under-development false';
  assert.equal(f.run().warnings.some(value => /disabled/.test(value)), true);
  assert.equal(existsSync(join(f.home, '.codex/hooks.json')), false);
  assert.equal(readFileSync(config, 'utf8'), '[features]\nhooks = false # user choice\n');
  f.env.FEATURES = 'hooks under-development true';
  const enabled = f.run();
  assert.equal(enabled.installed.some(item => item.agent === 'codex'), true);
  assert.equal(readFileSync(config, 'utf8'), '[features]\nhooks = false # user choice\n');
  for (const agent of ['kimi', 'hermes']) {
    assert.equal(enabled.skipped.some(item => item.agent === agent && /manual/.test(item.reason)), true);
  }
});

test('installer CLI --home prints machine-readable results without invoking real commands', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath,
    [join(distribution, 'scripts/install.mjs'), '--home', f.home], { env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.installed.length, 1);
  assert.equal(report.installed[0].agent, 'cli');
  assert.ok(report.installed[0].path.startsWith(f.home));
});

test('Kimi TOML appends a native hook without rewriting user settings', t => {
  const f = fixture(t, { kimi: 0 });
  const python = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
  assert.equal(python.status, 0);
  symlinkSync(python.stdout.trim(), join(f.home, 'fake-bin/python3'));
  const before = '# user choice\n[model]\nname = "mine"\n';
  const config = f.put('.kimi-code/config.toml', before);
  assert.equal(f.run().installed.some(item => item.agent === 'kimi'), true);
  const once = readFileSync(config, 'utf8');
  assert.ok(once.startsWith(before));
  assert.ok(once.includes('event = "SessionStart"'));
  assert.equal(f.run().installed.find(item => item.agent === 'kimi').changed, false);
  assert.equal(readFileSync(config, 'utf8'), once);
});

test('shared Codex hook registration is recognised without replacing its symlink', t => {
  const f = fixture(t, { codex: 'if(process.argv[2]==="features")console.log("hooks stable true")' });
  const command = 'if [ -n "${HC_TERMINAL_ID:-}" ]; then "$HOME/.local/bin/herdr-state" capture codex; fi';
  const source = f.put('shared-hooks.json', { hooks: { SessionStart: [{ hooks: [{ type: 'command', command, timeout: 10 }] }] } });
  const path = join(f.home, '.codex/hooks.json');
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(source, path);
  const before = readFileSync(source, 'utf8');
  const report = f.run();
  assert.equal(report.installed.find(item => item.agent === 'codex').changed, false);
  assert.equal(lstatSync(path).isSymbolicLink(), true);
  assert.equal(readFileSync(source, 'utf8'), before);
});
