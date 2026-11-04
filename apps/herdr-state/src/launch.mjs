import { spawn } from 'node:child_process';
import { Core } from './rpc.mjs';
import { resumeArgv } from './resume.mjs';

const payload = JSON.parse(Buffer.from(process.argv[2] || '', 'base64url').toString());
const argv = resumeArgv(payload.agent, payload.ref);
if (!argv || !process.env.HC_TERMINAL_ID) throw new Error('Invalid saved agent launch');
const core = new Core();
const terminal = process.env.HC_TERMINAL_ID;
let registered = false;
try {
  await core.call('terminal.label', { terminal, labels: {
    'herdr.state.agent': payload.agent,
    'herdr.state.ref': JSON.stringify(payload.ref),
    'herdr.state.running': String(process.pid),
    'herdr.state.restored': payload.key,
    'herdr.state.pending': '',
  } });
  registered = true;
  const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit' });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  process.exitCode = result.code ?? 1;
  if (result.signal) console.error(`Saved agent ended with ${result.signal}`);
} catch (error) {
  console.error(`State could not start ${payload.agent}: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (registered) {
    try {
      const current = await core.call('terminal.get', { terminal });
      if (current.labels['herdr.state.running'] === String(process.pid)) {
        await core.call('terminal.label', { terminal, labels: {
          'herdr.state.agent': '', 'herdr.state.ref': '', 'herdr.state.running': '', 'herdr.state.owner': '',
        } });
      }
    } catch (error) { console.error(`State cleanup failed: ${error.message}`); }
  }
  core.close();
}
