import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { Core } from './rpc.mjs';

const aliases = new Map(['claude', 'codex', 'copilot', 'devin', 'droid', 'kimi',
  'mastracode', 'pi', 'omp', 'hermes', 'opencode', 'kilo', 'qodercli', 'qwen',
  'agy', 'grok', 'letta'].map(name => [name, name]));
aliases.set('cursor-agent', 'cursor');

export function nativeAgent(argv) {
  if (!Array.isArray(argv) || !argv.length) return null;
  const command = basename(argv[0]).replace(/\.(exe|cmd)$/, '');
  if (aliases.has(command)) return aliases.get(command);
  if (!/^(node|bun|python[\d.]*)$/.test(command)) return null;
  let script;
  for (let index = 1; index < argv.length; index++) {
    const argument = argv[index];
    if (/^(?:-e|-p|-c|--eval|--print)(?:=|$)/.test(argument)) return null;
    if (argument === '-m') return /^hermes_cli(?:\.|$)/.test(argv[index + 1]) ? 'hermes' : null;
    if (['-r', '--require', '--import', '--loader', '--experimental-loader', '--title'].includes(argument)) { index++; continue; }
    if (argument.startsWith('-')) continue;
    script = argument;
    break;
  }
  if (!script) return null;
  const name = basename(script).replace(/\.(m?js|ts|py)$/, '');
  if (aliases.has(name)) return aliases.get(name);
  const packages = [
    [/\/@oh-my-pi\/pi-coding-agent\/dist\/cli\.js$/, 'omp'],
    [/\/@earendil-works\/pi-coding-agent\/dist\/(?:bundle\/)?cli\.js$/, 'pi'],
    [/\/@anthropic-ai\/claude-code\/cli\.js$/, 'claude'],
    [/\/@openai\/codex\/bin\/codex\.js$/, 'codex'],
    [/\/@letta-ai\/letta-code\/letta\.js$/, 'letta'],
    [/\/@moonshot-ai\/kimi-code\/dist\/main\.mjs$/, 'kimi'],
    [/\/@qwen-code\/qwen-code\/dist\/index\.js$/, 'qwen'],
    [/\/mastracode\/dist\/cli\.js$/, 'mastracode'],
  ];
  for (const [pattern, agent] of packages) if (pattern.test(script)) return agent;
  return null;
}

export async function linuxProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    const [stat, cmdline] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'), readFile(`/proc/${pid}/cmdline`, 'utf8'),
    ]);
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z') return null;
    return { pid, ppid: Number(fields[1]), argv: cmdline.split('\0').filter(Boolean) };
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code)) return null;
    throw error;
  }
}

async function lineage(pid, root, read) {
  const chain = [];
  const seen = new Set();
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const record = await read(pid);
    if (!record) return null;
    chain.push(record);
    if (pid === root) return chain;
    pid = record.ppid;
  }
  return null;
}

// Only the outermost native coding agent below the terminal's actual root may
// claim it. A launcher/shell is not an agent. Unknown ancestry fails closed.
export async function ownershipDecision(terminal, agent, caller, read = linuxProcess) {
  if (terminal.state !== 'live' || !Number.isSafeInteger(terminal.pid)) return { allowed: false, reason: 'terminal has no live local root' };
  const chain = await lineage(caller, terminal.pid, read);
  if (!chain) return { allowed: false, reason: 'caller is not a verified descendant of this terminal' };
  const agents = chain.filter(record => nativeAgent(record.argv));
  if (!agents.length || nativeAgent(agents[0].argv) !== agent) return { allowed: false, reason: 'native agent process could not be verified' };
  const candidate = agents[0].pid;
  if (agents.length > 1) return { allowed: false, reason: 'nested coding agent does not own the terminal' };
  const ownerText = terminal.labels?.['herdr.state.owner'];
  const owner = /^\d+$/.test(ownerText || '') ? Number(ownerText) : null;
  if (owner && owner !== candidate) {
    const previous = await lineage(owner, terminal.pid, read);
    // An existing live owner from another branch is still using this terminal.
    // A dead/stale PID, or an old nested child below this root agent, is replaceable.
    if (previous && !previous.some(record => record.pid === candidate)) {
      return { allowed: false, reason: 'another live native owner uses this terminal' };
    }
  }
  return { allowed: true, owner: candidate };
}

export async function writeOwnedLabels(agent, labels, { env = process.env, pid = process.pid,
  core: suppliedCore, readProcess = linuxProcess, expectedRef } = {}) {
  const terminal = env.HC_TERMINAL_ID;
  if (!terminal) return false;
  if (!/^t[0-9a-z]+$/.test(terminal)) throw new Error('expected a local HC_TERMINAL_ID');
  if (process.platform !== 'linux') throw new Error('native identity ownership requires Linux /proc');
  const core = suppliedCore || new Core(env);
  try {
    const view = await core.call('terminal.get', { terminal });
    const clear = labels['herdr.state.agent'] === '';
    if (clear && expectedRef !== undefined && (view.labels?.['herdr.state.ref'] ?? '') !== expectedRef) return false;
    const decision = await ownershipDecision(view, agent, pid, readProcess);
    if (!decision.allowed) return false;
    await core.call('terminal.label', { terminal, labels: {
      ...labels, 'herdr.state.ephemeral': labels['herdr.state.ephemeral'] ?? '',
      'herdr.state.owner': clear && labels['herdr.state.ephemeral'] !== '1' ? '' : String(decision.owner),
    } });
    return true;
  } finally {
    if (!suppliedCore) core.close();
  }
}
