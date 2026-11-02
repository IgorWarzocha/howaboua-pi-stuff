import { realpathSync } from 'node:fs';
import { dirname, resolve, isAbsolute, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface Context {
  sessionManager: { getSessionFile(): string | undefined };
}
interface OmpAPI {
  on(event: string, handler: (event: unknown, ctx: Context) => Promise<void>): unknown;
}

export default async function (omp: OmpAPI) {
  // OMP marks shells spawned by an existing agent. They do not own its terminal.
  if (process.env.OMPCODE === '1') return;
  const source = realpathSync(fileURLToPath(import.meta.url));
  const { writeOwnedLabels } = await import(pathToFileURL(resolve(dirname(source), '../src/ownership.mjs')).href);
  let previous: string | undefined;
  let reported: string | undefined;

  async function label(file?: string, ended = false) {
    const terminal = process.env.HC_TERMINAL_ID;
    if (!terminal) return;
    if (!/^t[0-9a-z]+$/.test(terminal)) throw new Error('herdr-state: expected a local terminal ID');
    if (file && (!isAbsolute(file) && !win32.isAbsolute(file)
        || /\p{Cc}/u.test(file) || Buffer.byteLength(file) > 4096)) {
      throw new Error('herdr-state: invalid OMP session file');
    }
    const wrote = await writeOwnedLabels('omp', {
      'herdr.state.agent': file ? 'omp' : '',
      'herdr.state.ref': file ? JSON.stringify({ kind: 'path', value: file }) : '',
      'herdr.state.ephemeral': !file && !ended ? '1' : '',
    }, { expectedRef: file ? undefined : reported });
    if (wrote) {
      previous = file;
      reported = ended ? undefined : file ? JSON.stringify({ kind: 'path', value: file }) : '';
    }
  }

  async function report(_event: unknown, ctx: Context) {
    await label(ctx.sessionManager.getSessionFile());
  }
  omp.on('session_start', report);
  omp.on('session_switch', report);
  omp.on('agent_start', async (_event, ctx) => {
    const file = ctx.sessionManager.getSessionFile();
    if (file !== previous) await label(file);
  });
  omp.on('session_shutdown', async () => label(undefined, true));
}
