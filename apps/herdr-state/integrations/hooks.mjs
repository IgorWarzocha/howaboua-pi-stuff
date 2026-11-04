import { fileURLToPath, pathToFileURL } from 'node:url';

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

// Print merge fragments only. Never read or modify a live agent configuration.
export function hookSnippet(agent, node = process.execPath,
  capture = fileURLToPath(new URL('../src/capture.mjs', import.meta.url))) {
  const command = [node, capture, agent].map(quote).join(' ');
  const handler = { type: 'command', command, timeout: 10 };
  const nested = matcher => ({ hooks: { SessionStart: [{
    ...(matcher ? { matcher } : {}), hooks: [handler],
  }] } });
  switch (agent) {
    case 'claude': return nested('^(startup|resume|clear|compact|fork)$');
    case 'codex': case 'droid': case 'grok': return nested();
    case 'qodercli': return nested('*');
    case 'qwen': {
      const snippet = nested('*');
      snippet.hooks.SessionStart[0].hooks[0].timeout = 10_000;
      return snippet;
    }
    case 'letta': return { hooks: { SessionStart: [{ hooks: [{
      ...handler, timeout: 10_000, quiet: true,
    }] }] } };
    case 'devin': return { hooks: Object.fromEntries([
      'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop',
    ].map(event => [event, [{ hooks: [{ ...handler }] }]])) };
    case 'copilot': return { hooks: { SessionStart: [{ type: 'command', bash: command, timeoutSec: 10 }] } };
    case 'cursor': return { version: 1, hooks: { sessionStart: [{ command }] } };
    case 'mastracode': return { SessionStart: [{ ...handler, timeout: 10_000 }] };
    case 'agy': return { 'herdr-state': { PreInvocation: [handler] } };
    case 'kimi': return `[[hooks]]\nevent = "SessionStart"\ncommand = ${JSON.stringify(command)}\ntimeout = 10\n`;
    default: throw new Error(`no command-hook snippet for ${agent}; see integrations/README.md`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.platform === 'win32') throw new Error('snippet commands require a POSIX shell');
    if (process.argv.length !== 3) throw new Error('usage: node integrations/hooks.mjs <agent>');
    const result = hookSnippet(process.argv[2]);
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
