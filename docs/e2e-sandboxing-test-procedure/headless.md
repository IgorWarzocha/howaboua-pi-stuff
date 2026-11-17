# Focused headless checks

For backend acceptance, we have used Pi's SDK to run a task with the candidate extensions loaded. The important distinction from a direct model smoke test is `createAgentSession` followed by `bindExtensions`: notes, tools, preparation and continuation run through the application.

The launch code below is extracted from that approach. It leaves the scenario, model and guest configuration explicit rather than pretending there is one universal test task.

## Prepare the guest configuration

Run from the candidate checkout inside the VM. Use the isolated agent directory printed by `sandbox:setup`, with the affected candidate packages in its `settings.json`. Configure its model access through Pi. Our live reviews used temporary access provisioned for the selected provider, not credentials embedded in the runner.

Choose the execution mode and continuity settings in that directory before launch. For a Notes test, include Notes in the loaded packages. For a PCC Remote test, do not let Notes take over continuity. Put the task in `scenario.txt`. For example, a continuity task can request a note write, a history lookup, a fresh checkpoint, `new_context` and readback after rollover.

Set `PI_TEST_MODEL` to an authenticated `provider/model` already registered in the guest's `models.json` or Pi's built-in catalogue. Register newer models missing from the catalogue before running. This lookup happens before extensions load.

```sh
export PI_CODING_AGENT_DIR=/path/to/isolated/guest-agent
export PI_TEST_MODEL=provider/registered-model-id
node --input-type=module <<'JS'
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ModelRuntime, SettingsManager, DefaultResourceLoader, createAgentSession,
} from '@earendil-works/pi-coding-agent';

const cwd = process.cwd();
const agentDir = process.env.PI_CODING_AGENT_DIR;
if (!agentDir) throw new Error('Set the isolated guest agent directory');
const modelRef = process.env.PI_TEST_MODEL;
if (!modelRef) throw new Error('Set PI_TEST_MODEL to a registered provider/model');
const runtime = await ModelRuntime.create({
  authPath: join(agentDir, 'auth.json'),
  modelsPath: join(agentDir, 'models.json'),
  allowModelNetwork: true,
});
const model = runtime.getModels().find(model => `${model.provider}/${model.id}` === modelRef);
if (!model) throw new Error(`Model unavailable: ${modelRef}. Register it in the guest models.json first.`);
const settingsManager = SettingsManager.create(cwd, agentDir);
await mkdir('evidence', { recursive: true });
const audit = pi => {
  pi.on('before_provider_request', async event => {
    await appendFile('evidence/requests.jsonl', JSON.stringify(event.payload) + '\n');
  });
};
const resourceLoader = new DefaultResourceLoader({
  cwd, agentDir, settingsManager,
  extensionFactories: [{ name: 'review-audit', factory: audit }],
  noSkills: true, noPromptTemplates: true,
});
await resourceLoader.reload();
const { session, extensionsResult } = await createAgentSession({
  cwd, agentDir, modelRuntime: runtime, model,
  thinkingLevel: 'low', settingsManager, resourceLoader,
});
try {
  if (extensionsResult.errors.length) {
    throw new Error(JSON.stringify(extensionsResult.errors));
  }
  await session.bindExtensions({ mode: 'print', onError: console.error });
  await session.prompt(await readFile('scenario.txt', 'utf8'));
  await session.waitForIdle();
  console.log('DONE', session.sessionFile);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  session.dispose();
}
process.exit(process.exitCode ?? 0);
JS
```

Choose `PI_TEST_MODEL` and the thinking level for the route under test. This example deliberately exits its disposable process after disposal because extensions may retain transport handles. The original acceptance runner also needed its completed process stopped.

## Inspect the result

`DONE` means the task settled, not that it passed. We inspect the saved Pi session, tool results, request captures and the side effects requested by the scenario. Request captures contain the test prompts and content.

For a Lite claim, inspect the effective request shape described in [Models and evidence](models-and-evidence.md). For a context-window claim, verify that a real rollover occurred and the agent retrieved the saved information afterwards. For a failure, preserve its original request and result before retesting.

The live acceptance runner also recorded lifecycle and tool events through `before_agent_start` and `session.subscribe`. Those observations helped distinguish application execution from model choice. They were scenario-specific captures, not a separate transcript store or permanent test suite.
