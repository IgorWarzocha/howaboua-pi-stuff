import { labelArgs } from '../src/capture.mjs';
import { writeOwnedLabels } from '../src/ownership.mjs';

// Native chat.message identifies the addressed session. Server-global session
// creation/update events do not identify the terminal's selected session.
export function sessionHooks(agent, write = writeOwnedLabels) {
  if (!process.env.HC_TERMINAL_ID) return {};
  const terminal = process.env.HC_TERMINAL_ID;
  const children = new Set();
  let selected;
  let revision = 0;
  let queue = Promise.resolve();

  function publish(id) {
    const argv = labelArgs(terminal, agent, { sessionID: id }, id === undefined);
    const previous = selected;
    selected = id;
    const current = ++revision;
    const pending = queue.then(async () => {
      if (current !== revision) return;
      const labels = Object.fromEntries(argv.slice(2).map(arg => {
        const index = arg.indexOf('=');
        return [arg.slice(0, index), arg.slice(index + 1)];
      }));
      await write(agent, labels, { expectedRef: id === undefined && previous
        ? JSON.stringify({ kind: 'id', value: previous }) : undefined });
    });
    // Keep later reports usable after an error, but return the original failure
    // to the host hook runner rather than disguising a failed label as success.
    queue = pending.catch(() => {});
    return pending;
  }

  return {
    'chat.message': async ({ sessionID }) => {
      if (typeof sessionID !== 'string' || children.has(sessionID)) return;
      await publish(sessionID);
    },
    event: async ({ event }) => {
      const properties = event?.properties;
      const info = properties?.info;
      if (['session.created', 'session.updated'].includes(event?.type)
          && typeof info?.id === 'string' && info.parentID) {
        children.add(info.id);
        if (info.id === selected) await publish(undefined);
      }
      const id = properties?.sessionID ?? info?.id;
      if (event?.type === 'session.deleted') {
        children.delete(id);
        if (id !== undefined && id === selected) await publish(undefined);
      } else if (event?.type === 'session.updated' && id !== undefined && id === selected) {
        await publish(id);
      }
    },
  };
}

export function localOpenCodeClient(args = process.argv.slice(2)) {
  const end = args.indexOf('--');
  args = args.slice(0, end === -1 ? args.length : end);
  if (args.some(arg => arg === '--attach' || arg.startsWith('--attach='))) return false;
  while (args[0] === '--print-logs' || args[0] === '--log-level' || args[0]?.startsWith('--log-level=')) {
    args.splice(0, args[0] === '--log-level' ? 2 : 1);
  }
  return args[0] === 'run'
    || (!['serve', 'web', 'attach'].includes(args[0]) && args.includes('--mini'));
}
