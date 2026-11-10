import { readdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
}
for (const dir of ['src', 'mod', 'scripts']) for (const file of await readdir(join(root, dir))) {
  if (/\.(mjs|js)$/.test(file)) run(process.execPath, ['--check', join(dir, file)]);
}
run(process.execPath, ['scripts/smoke.mjs']);
const temporary = await mkdtemp('/var/tmp/proactive-check-');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HC_')));
Object.assign(env, { HERDR_APP_HOME: temporary, HC_SESSION: 'proactive-check', HC_SOCKET: join(temporary, 'core.sock'),
  XDG_STATE_HOME: join(temporary, 'state'), XDG_CONFIG_HOME: join(temporary, 'config') });
try {
  await cp(join(root, 'mod'), join(temporary, 'mods/proactive'), { recursive: true });
  run('herdr-app', ['check', join(temporary, 'mods/proactive')], env);
} finally {
  spawnSync('hc', ['server', 'stop'], { env, stdio: 'ignore', timeout: 10000 });
  await rm(temporary, { recursive: true, force: true });
}
