#!/usr/bin/env node
import { Core } from './core.mjs';
import { serve } from './serve.mjs';
import { status, command } from './commands.mjs';

const usage = 'herdr-proactive serve | install-mod [app-home] | status | configure <policy-json> | remove|run|bind|acknowledge <id-json> | snooze <id-until-json> | reset <space-json>';
const action = process.argv[2];
let core;
try {
  if (!action || action === '--help') console.log(usage + '\nInstructions: <workspace>/.herdr/proactive/<name>/PROACTIVE.md and pulses/<name>/PULSE.md. Native panel edits these same files.');
  else if (action === 'serve') await serve();
  else if (action === 'install-mod') {
    const { installMod } = await import('../scripts/install.mjs');
    console.log(JSON.stringify(await installMod(process.argv[3])));
  } else {
    if (!['status', 'configure', 'remove', 'run', 'bind', 'acknowledge', 'snooze', 'reset'].includes(action)) throw new Error(usage);
    const input = process.argv[3] ? JSON.parse(process.argv[3]) : {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a JSON object');
    core = new Core();
    const info = await core.call('server.status');
    const result = action === 'status' ? await status(core, info.core.id, process.env) :
      await command(core, info.core.id, process.env, action, input);
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.log(JSON.stringify({ error: { message: error.message, kind: error.kind ?? error.code ?? 'proactive' } }));
  process.exitCode = 1;
} finally { core?.close(); }
