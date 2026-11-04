import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export default async function (pi: ExtensionAPI) {
  // Pi's loader resolves static imports beside the symlink, not its target.
  const source = realpathSync(fileURLToPath(import.meta.url));
  const { writeOwnedLabels } = await import(pathToFileURL(resolve(dirname(source), '../src/ownership.mjs')).href);
  let reported: string | undefined;
  async function label(ref?: { kind: 'path'; value: string }, ended = false) {
    const terminal = process.env.HC_TERMINAL_ID;
    if (!terminal) return;
    if (!/^t[0-9a-z]+$/.test(terminal)) throw new Error('herdr-state: expected a local terminal ID');
    const wrote = await writeOwnedLabels('pi', {
      'herdr.state.agent': ref ? 'pi' : '',
      'herdr.state.ref': ref ? JSON.stringify(ref) : '',
      'herdr.state.ephemeral': !ref && !ended ? '1' : '',
    }, { expectedRef: ref ? undefined : reported });
    if (wrote) reported = ended ? undefined : ref ? JSON.stringify(ref) : '';
  }

  // Installed Pi emits session_start after startup, reload, new, resume and fork.
  pi.on('session_start', async (_event, ctx) => {
    const file = ctx.sessionManager.getSessionFile();
    // --no-session still has an ID, but there is no persisted session to resume.
    await label(file ? { kind: 'path', value: file } : undefined);
  });
  pi.on('session_shutdown', async () => label(undefined, true));
}
