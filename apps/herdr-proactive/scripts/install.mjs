import { cp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const marker = '# installed by herdr-proactive';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const missing = error => { if (error.code !== 'ENOENT') throw error; return null; };

export async function installMod(home = process.env.HERDR_APP_HOME || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'herdr-app')) {
  const target = join(resolve(home), 'mods', 'proactive');
  const previous = await readFile(join(target, '.herdr-proactive'), 'utf8').catch(missing);
  if (previous !== null && previous !== '1\n') throw new Error('Unrecognised proactive mod marker');
  if (previous === null) {
    try { await mkdir(target, { recursive: false }); }
    catch (error) {
      if (error.code === 'ENOENT') { await mkdir(dirname(target), { recursive: true }); await mkdir(target); }
      else if (error.code === 'EEXIST') throw new Error('Existing mods/proactive is not owned by this installer');
      else throw error;
    }
  }
  await cp(join(root, 'mod'), target, { recursive: true, filter: source => !/\.(d\.ts)$|jsconfig\.json$/.test(source) });
  await writeFile(join(target, '.herdr-proactive'), '1\n', { mode: 0o600 });
  return { installed: target };
}

export async function install(binDir = join(homedir(), '.local', 'bin')) {
  if (process.platform === 'win32') throw new Error('The source-linked helper installer requires a POSIX shell');
  const target = join(resolve(binDir), 'herdr-proactive');
  const existing = await readFile(target, 'utf8').catch(missing);
  if (existing !== null && !existing.split('\n').includes(marker)) throw new Error('Existing helper is not owned by this installer');
  await mkdir(dirname(target), { recursive: true });
  const temporary = target + '.' + process.pid;
  try {
    await writeFile(temporary, '#!/bin/sh\n' + marker + '\nexec ' + quote(process.execPath) + ' ' + quote(join(root, 'src/cli.mjs')) + ' "$@"\n', { mode: 0o700, flag: 'wx' });
    const { rename } = await import('node:fs/promises');
    await rename(temporary, target);
    await chmod(target, 0o700);
  } finally { await rm(temporary, { force: true }); }
  return { installed: target, sourceLinked: true };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await install())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
