import { pathToFileURL } from 'node:url';
import { resumeArgv } from './resume.mjs';
import { writeOwnedLabels } from './ownership.mjs';

const idKeys = ['session_id', 'sessionId', 'sessionID', 'conversation_id',
  'conversationId', 'conversationID', 'thread_id', 'threadId', 'thread-id', 'agent_session_id'];
const pathKeys = ['session_path', 'sessionPath', 'session_file', 'sessionFile', 'agent_session_path'];

export function refFromReport(agent, report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return null;
  if (agent === 'letta' && report.conversation_id === 'default') {
    if (typeof report.agent_id !== 'string') return null;
    const ref = { kind: 'id', value: `default:${report.agent_id}` };
    return resumeArgv(agent, ref) ? ref : null;
  }
  // A transcript is not necessarily a resumable session file. Only Pi/OMP use paths.
  for (const [kind, keys] of [['path', pathKeys], ['id', idKeys]]) {
    for (const key of keys) {
      const ref = { kind, value: report[key] };
      if (resumeArgv(agent, ref)) return ref;
    }
  }
  return null;
}

export function labelArgs(terminal, agent, report, clear = false) {
  // The hook runs beside the agent. Never accept a remote hc address here.
  if (typeof terminal !== 'string' || !/^t[0-9a-z]+$/.test(terminal)) {
    throw new Error('HC_TERMINAL_ID must be a local terminal ID');
  }
  if (!resumeArgv(agent, { kind: 'id', value: 'validation' })) {
    throw new Error('unsupported agent');
  }
  if (clear) return ['label', terminal, 'herdr.state.agent=', 'herdr.state.ref=', 'herdr.state.ephemeral='];
  const ref = refFromReport(agent, report);
  if (!ref) throw new Error('hook did not report a valid native session identity');
  return ['label', terminal, `herdr.state.agent=${agent}`, `herdr.state.ref=${JSON.stringify(ref)}`, 'herdr.state.ephemeral='];
}

export async function main(args = process.argv.slice(2), env = process.env, input = process.stdin) {
  const [agent, mode, ...extra] = args;
  if (extra.length || (mode !== undefined && mode !== '--clear')) {
    throw new Error('usage: node src/capture.mjs <agent> [--clear]');
  }
  // Installed hooks remain harmless outside hc, without waiting on stdin.
  if (!env.HC_TERMINAL_ID) return;
  let report;
  if (mode !== '--clear') {
    let text = '';
    for await (const chunk of input) {
      text += chunk;
      if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('hook JSON exceeds 1 MiB');
    }
    report = JSON.parse(text);
  }
  const argv = labelArgs(env.HC_TERMINAL_ID, agent, report, mode === '--clear');
  // Codex children can inherit the parent terminal. Do not overwrite its identity.
  if (agent === 'codex' && mode !== '--clear' && env.CODEX_THREAD_ID
      && refFromReport(agent, report).value !== env.CODEX_THREAD_ID) return;
  const labels = Object.fromEntries(argv.slice(2).map(arg => {
    const index = arg.indexOf('=');
    return [arg.slice(0, index), arg.slice(index + 1)];
  }));
  await writeOwnedLabels(agent, labels, { env });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`herdr-state capture: ${error.message}`);
    process.exitCode = 1;
  });
}
