import { spawn } from 'child_process';
import { cdpUsage } from './cdp-lib/cli.mjs';
import { probeDebugPort, sleep } from './cdp-lib/runtime.mjs';

const launcherUsage = cdpUsage({
  commands: [{
    syntax: 'start',
    description: 'Start the authenticated graphical browser on demand (Linux/systemd)',
  }],
});
const discoveryRecovery = 'Run "cdp start", enable remote debugging, or set CDP_PORT/CDP_PORT_FILE.';

const BROWSER_START_TIMEOUT = 10000;
const BROWSER_UNIT = 'chrome-cdp-browser.service';

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function configuredDebugEndpoint() {
  return {
    port: process.env.CDP_PORT || '9222',
    host: process.env.CDP_HOST || '127.0.0.1',
  };
}

async function waitForDebugEndpoint(endpoint = configuredDebugEndpoint(), timeout = BROWSER_START_TIMEOUT) {
  const { port, host } = endpoint;
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await probeDebugPort(port, host);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Browser did not expose CDP at ${host}:${port} within ${timeout}ms${lastError ? ` (${lastError.message})` : ''}`);
}

async function unitExists(systemctl) {
  const result = await runProcess(systemctl, [
    '--user', 'show', BROWSER_UNIT, '--property=LoadState', '--value',
  ]);
  return result.code === 0 && result.stdout !== 'not-found';
}

async function waitForBrowserOrUnitRemoval(systemctl, endpoint, timeout = BROWSER_START_TIMEOUT) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await probeDebugPort(endpoint.port, endpoint.host);
      return 'browser';
    } catch {}
    if (!await unitExists(systemctl)) return 'removed';
    await sleep(100);
  }
  return 'timeout';
}

async function startBrowser() {
  const endpoint = configuredDebugEndpoint();
  const { port, host } = endpoint;
  try {
    await probeDebugPort(port, host);
    return `Browser already running with CDP at ${host}:${port}`;
  } catch {}

  if (process.platform !== 'linux') {
    throw new Error('Automatic browser launch currently requires a Linux systemd user session. Start the authenticated browser normally, then run "cdp list".');
  }

  const systemctl = process.env.CDP_SYSTEMCTL || '/usr/bin/systemctl';
  const systemdRun = process.env.CDP_SYSTEMD_RUN || '/usr/bin/systemd-run';
  const browser = process.env.CDP_BROWSER || '/usr/bin/chromium';
  let lastLaunchError = '';

  // A fixed transient unit gives the browser a clean lifetime, but concurrent
  // starts and immediate browser restart cycles can briefly leave that unit busy.
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await waitForBrowserOrUnitRemoval(systemctl, endpoint);
    if (state === 'browser') {
      return `Browser already running with CDP at ${host}:${port}`;
    }
    if (state === 'timeout') {
      throw new Error(`Browser unit ${BROWSER_UNIT} remained loaded without exposing CDP at ${host}:${port}`);
    }

    await runProcess(systemctl, ['--user', 'reset-failed', BROWSER_UNIT]);
    const browserArgs = [
      `--remote-debugging-address=${host}`,
      `--remote-debugging-port=${port}`,
    ];
    if (process.env.CDP_PROFILE_DIRECTORY) {
      browserArgs.push(`--profile-directory=${process.env.CDP_PROFILE_DIRECTORY}`);
    }
    browserArgs.push('about:blank');

    const launched = await runProcess(systemdRun, [
      '--user',
      '--unit=chrome-cdp-browser',
      '--collect',
      '--property=Type=exec',
      '--property=Restart=no',
      browser,
      ...browserArgs,
    ]);
    if (launched.code === 0) {
      await waitForDebugEndpoint(endpoint);
      return `Started authenticated browser with CDP at ${host}:${port}`;
    }
    lastLaunchError = launched.stderr || launched.stdout || `exit ${launched.code}`;
  }

  throw new Error(`Could not launch the browser through the graphical user session: ${lastLaunchError}`);
}

export { discoveryRecovery, launcherUsage, startBrowser };
