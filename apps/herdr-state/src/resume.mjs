import { posix, win32 } from 'node:path';

const flags = new Map([
  ['claude', '--resume'], ['codex', 'resume'], ['copilot', '--resume='],
  ['devin', '--resume'], ['droid', '--resume'], ['kimi', '--session'],
  ['mastracode', '--thread'], ['pi', '--session'], ['omp', '--resume='],
  ['hermes', '--resume'], ['opencode', '--session'], ['kilo', '--session'],
  ['qodercli', '--resume'], ['qwen', '--resume'], ['cursor', '--resume'],
  ['agy', '--conversation'], ['grok', '--resume'], ['letta', '--conversation'],
]);

export function resumeArgv(agent, ref) {
  if (!flags.has(agent) || !ref || typeof ref.value !== 'string') return null;
  const { kind, value } = ref;
  if (!value.trim() || /\p{Cc}/u.test(value) || value.startsWith('-')) return null;
  if (kind === 'id') {
    if (Buffer.byteLength(value) > 512) return null;
  } else if (kind === 'path') {
    if (!['pi', 'omp'].includes(agent) || Buffer.byteLength(value) > 4096
        || !(posix.isAbsolute(value) || win32.isAbsolute(value))) return null;
  } else return null;

  if (agent === 'letta' && value.startsWith('default:')) {
    const id = value.slice('default:'.length);
    if (!id.trim() || id.startsWith('-')) return null;
    return ['letta', '--conversation', 'default', '--agent', id];
  }
  const command = agent === 'cursor'
    ? (process.platform === 'win32' ? 'cursor-agent.cmd' : 'cursor-agent') : agent;
  const flag = flags.get(agent);
  return flag.endsWith('=') ? [command, flag + value] : [command, flag, value];
}
