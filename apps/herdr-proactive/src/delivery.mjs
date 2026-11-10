import { randomUUID } from 'node:crypto';

export async function startDelivery({ core, state, catalog, policy, runtime, opportunity, terminal, finished }) {
  const job = opportunity.kind === 'job' ? policy.jobs.find(item => item.id === opportunity.key) : null;
  const receipt = { id: randomUUID(), terminal: policy.terminal, kind: opportunity.kind, job: opportunity.key,
    path: job?.path ?? policy.path, at: Date.now(), outcome: 'sending' };
  runtime.inflight = receipt;
  runtime.receipts = [...runtime.receipts.slice(-31), receipt];
  runtime.phase = 'sending';
  runtime.dispatchTurn = terminal.turn;
  // Intent is durable before any bytes. After a crash this attempt is uncertain,
  // not permission to re-read an edited file and execute it again.
  await state.flush(true);
  await state.save();
  let current;
  try { current = catalog.current(policy, job); }
  catch (error) { runtime.lastError = error.message; current = false; }
  if (!current) {
    runtime.inflight = null;
    receipt.outcome = 'deferred';
    runtime.phase = 'waiting'; runtime.reason = 'Instruction or control file changed before acceptance'; runtime.nextAt = null;
    await state.save();
    return false;
  }
  // No awaited operation between final file revisions and starting the send.
  const text = `[Herdr ${opportunity.kind === 'generic' ? 'proactive check-in' : 'automation'}]\n` +
    `Workspace: ${policy.root}\nInstructions: ${receipt.path}\nRead applicable workspace and pulse-local AGENTS.md instructions.\n\n${opportunity.prompt}`;
  void core.call('terminal.send', { terminal: policy.terminal, text, if: 'idle', force: false })
    .then(result => finished(receipt.id, result, null))
    .catch(error => finished(receipt.id, null, error));
  return true;
}

export function settleDelivery(runtime, receiptId, result, error, seen) {
  if (!runtime?.inflight || runtime.inflight.id !== receiptId) throw new Error('Delivery owner disappeared');
  const receipt = runtime.receipts.find(item => item.id === receiptId);
  const noInput = error && ['status_mismatch', 'blocked', 'unavailable', 'finished', 'not_found', 'machine_unknown', 'config', 'invalid_params'].includes(error.kind);
  receipt.outcome = noInput ? 'deferred' : error || result?.started !== true ? 'uncertain' : 'started';
  receipt.error = error?.message ?? (result?.started !== true ? 'Input was sent, but a new turn was not observed. Inspect before continuing.' : null);
  runtime.inflight = null;
  runtime.lastError = receipt.error;
  if (noInput) {
    runtime.phase = 'waiting'; runtime.reason = receipt.error; runtime.nextAt = null;
  } else {
    runtime.lastDispatchAt = receipt.at;
    runtime.lastGenericAt = receipt.at;
    runtime.pendingUnseen = (seen ?? -1) <= runtime.dispatchTurn;
    if (receipt.kind === 'job') runtime.jobs[receipt.job] = receipt.at;
    if (receipt.kind === 'manual') runtime.manualRequest = receipt.job;
    runtime.awaitingAck = receipt.outcome === 'uncertain';
  }
  return { deferred: Boolean(noInput), terminal: receipt.terminal };
}
