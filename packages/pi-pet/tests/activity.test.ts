import assert from "node:assert/strict";
import { test } from "node:test";
import { ActivityCoordinator, LatestActivityPublisher } from "../extensions/activity.ts";
import { assistantReplyPreview } from "../extensions/conversation.ts";

test("activity coordinator gives waiting precedence across parallel tools", () => {
  const activity = new ActivityCoordinator();
  assert.equal(activity.agentStarted().activity, "working");
  assert.deepEqual(activity.toolStarted("one", "exec"), { activity: "working", note: "Using exec" });
  assert.deepEqual(activity.toolStarted("two", "ask"), {
    activity: "waiting",
    note: "Waiting for your answer",
  });
  assert.equal(activity.toolEnded("one", "exec", false).activity, "waiting");
  assert.deepEqual(activity.toolEnded("two", "ask", false), { activity: "working", note: "Thinking" });
  assert.equal(activity.toolEnded("three", "exec", true).activity, "failed");
  assert.equal(activity.turnStarted().activity, "working");
  assert.equal(activity.settled().activity, "settled");
});

test("activity publisher coalesces stale updates while a request is in flight", async () => {
  const sent: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const publisher = new LatestActivityPublisher(
    async (update) => {
      sent.push(update.activity);
      if (sent.length === 1) await first;
    },
    (error) => assert.fail(error instanceof Error ? error : String(error)),
  );

  publisher.publish({ activity: "working", note: "Thinking" });
  await Promise.resolve();
  publisher.publish({ activity: "waiting", note: "Waiting" });
  publisher.publish({ activity: "working", note: "Using exec" });
  publisher.publish({ activity: "settled", note: "Ready" });
  releaseFirst?.();
  await first;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, ["working", "settled"]);
});

test("activity publisher restores the latest state after an older state is already sending", async () => {
  const sent: string[] = [];
  let releaseWaiting: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    releaseWaiting = resolve;
  });
  const publisher = new LatestActivityPublisher(
    async (update) => {
      sent.push(update.activity);
      if (update.activity === "waiting") await waiting;
    },
    (error) => assert.fail(error instanceof Error ? error : String(error)),
  );
  publisher.publish({ activity: "working", note: "Thinking" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  publisher.publish({ activity: "waiting", note: "Waiting" });
  await Promise.resolve();
  publisher.publish({ activity: "working", note: "Thinking" });
  releaseWaiting?.();
  await waiting;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, ["working", "waiting", "working"]);
});

test("activity publisher keeps session resets behind an in-flight request", async () => {
  const sent: string[] = [];
  let releaseOldSession: (() => void) | undefined;
  const oldSession = new Promise<void>((resolve) => {
    releaseOldSession = resolve;
  });
  const publisher = new LatestActivityPublisher(
    async (update) => {
      sent.push(update.note);
      if (update.note === "old session") await oldSession;
    },
    (error) => assert.fail(error instanceof Error ? error : String(error)),
  );
  publisher.publish({ activity: "working", note: "old session" });
  await Promise.resolve();
  publisher.reset();
  publisher.publish({ activity: "idle", note: "new session" });
  await Promise.resolve();
  assert.deepEqual(sent, ["old session"]);
  releaseOldSession?.();
  await oldSession;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, ["old session", "new session"]);
});

test("conversation preview carries only bounded assistant text", () => {
  assert.equal(
    assistantReplyPreview({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "secret" },
        { type: "text", text: "Done.\n\nThe checks pass." },
        { type: "toolCall", name: "exec" },
      ],
    }),
    "Done. The checks pass.",
  );
  assert.equal(assistantReplyPreview({ role: "user", content: "hello" }), undefined);
  assert.equal(
    assistantReplyPreview({ role: "assistant", content: [{ type: "text", text: "x".repeat(500) }] })?.length,
    280,
  );
});
