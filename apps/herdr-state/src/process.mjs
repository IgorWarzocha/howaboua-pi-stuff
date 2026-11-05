import { readFile, readlink } from 'node:fs/promises';
import { basename } from 'node:path';

export const SHELL_NAMES = new Set(['sh', 'bash', 'dash', 'zsh', 'fish', 'nu', 'ksh']);
export const ENV_KEYS = ['PATH', 'PI_CODING_AGENT_DIR', 'PI_CONFIG_DIR', 'CODEX_HOME',
  'CLAUDE_CONFIG_DIR', 'COPILOT_HOME', 'OPENCODE_CONFIG_DIR', 'HERMES_HOME', 'GROK_HOME', 'QWEN_HOME'];

export async function agentEnvironment(terminal) {
  const pid = terminal.foreground?.pid || terminal.pid;
  if (process.platform !== 'linux' || !Number.isInteger(pid)) return {};
  try {
    const entries = (await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0');
    return Object.fromEntries(entries.map(entry => {
      const split = entry.indexOf('=');
      return [entry.slice(0, split), entry.slice(split + 1)];
    }).filter(([key]) => ENV_KEYS.includes(key)));
  } catch { return {}; }
}

// Fail closed. Only otherwise unused shell panes may be replaced. No keystrokes are sent.
export async function idleShell(terminal) {
  if (process.platform !== 'linux' || terminal.state !== 'live' || !Number.isInteger(terminal.pid) || terminal.status) return false;
  try {
    const executable = basename(await readlink(`/proc/${terminal.pid}/exe`));
    const children = await readFile(`/proc/${terminal.pid}/task/${terminal.pid}/children`, 'utf8');
    return SHELL_NAMES.has(executable) && !children.trim();
  } catch { return false; }
}

export function quote(argument) {
  if (typeof argument !== 'string' || /[\x00-\x1f\x7f]/.test(argument)) throw new Error('Unsafe command argument');
  return "'" + argument.replaceAll("'", "'\\''") + "'";
}
