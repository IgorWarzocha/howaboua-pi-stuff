import { isDeepStrictEqual } from 'node:util';
import { emptyActivity } from './activity.mjs';

// Definition files describe intent. Scheduling cursors and receipts belong only
// to private runtime state, so a body edit does not reseed a recurring schedule.
export function reconcileDefinitions(state, catalog, now) {
  for (const [root, snapshot] of catalog.snapshots) {
    const space = catalog.roots.get(root).id;
    if (snapshot.reset && state.value.resets[space] !== snapshot.reset) {
      state.activities.set(space, emptyActivity());
      state.dirty.add(space);
      state.value.resets[space] = snapshot.reset;
    }
  }
  for (const policy of catalog.policies) {
    const runtime = state.policy(policy.id);
    if (runtime.sourceEnabled === false && policy.enabled) runtime.enabledAt = now;
    runtime.enabledAt ??= now;
    runtime.sourceEnabled = policy.enabled;
    policy.enabledAt = runtime.enabledAt;
    if (policy.acknowledgeRequest && policy.acknowledgeRequest !== runtime.acknowledgeRequest) {
      runtime.acknowledgeRequest = policy.acknowledgeRequest;
      runtime.awaitingAck = false;
      runtime.lastError = null;
    }
    runtime.snoozedUntil = policy.snoozedUntil;
    runtime.jobDefinitions ??= {};
    for (const job of policy.jobs) {
      const previous = runtime.jobDefinitions[job.id];
      if (job.schedule.kind === 'interval' && job.schedule.anchor === undefined) {
        job.schedule.anchor = previous?.schedule.anchor ?? now + job.schedule.minutes * 60000;
      }
      const unchanged = previous && isDeepStrictEqual(previous.schedule, job.schedule) && (previous.enabled || !job.enabled);
      job.createdAt = unchanged ? previous.createdAt : now;
      runtime.jobDefinitions[job.id] = { createdAt: job.createdAt, schedule: structuredClone(job.schedule), enabled: job.enabled };
    }
    for (const id of Object.keys(runtime.jobDefinitions)) if (!policy.jobs.some(job => job.id === id)) {
      delete runtime.jobDefinitions[id]; delete runtime.jobs[id];
    }
  }
}
