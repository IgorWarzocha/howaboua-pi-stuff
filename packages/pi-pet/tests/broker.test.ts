import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PiPetConfig } from "../src/config.ts";
import { PiPetBroker } from "../src/server/broker.ts";
import { loadPet } from "../src/server/pet-loader.ts";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

function headers(token: string, session?: string): Record<string, string> {
  const result: Record<string, string> = { authorization: `Bearer ${token}` };
  if (session) result["x-pi-pet-session"] = session;
  return result;
}

async function nextEvent(response: Response, expected: string): Promise<unknown> {
  if (!response.body) throw new Error("Missing stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`Stream ended before ${expected}.`);
    buffer += decoder.decode(chunk.value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const record = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = record
        .split("\n")
        .find((line) => line.startsWith("event: "))
        ?.slice(7);
      const data = record
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
      if (event === expected && data) {
        return JSON.parse(data) as unknown;
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

test("broker enforces roles and routes one authenticated prompt session", async () => {
  const port = await freePort();
  const config: PiPetConfig = {
    schemaVersion: 1,
    host: "127.0.0.1",
    port,
    activePet: "clawa",
    agentToken: "agent-token-that-is-longer-than-32-characters",
    displayToken: "display-token-that-is-longer-than-32-chars",
  };
  const loaded = await loadPet(join(process.cwd(), "pets"), "clawa");
  const webRoot = await mkdtemp(join(tmpdir(), "pi-pet-web-"));
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Pi Pet</title>");
  const broker = new PiPetBroker({ config, catalog: loaded.catalog, petDirectory: loaded.directory, webRoot });
  await broker.listen();
  const base = `http://127.0.0.1:${port}`;
  const displayAbort = new AbortController();
  let agentAbort = new AbortController();
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(`${base}/api/v1/status`)).status, 401);
    const status = await fetch(`${base}/api/v1/status`, { headers: headers(config.displayToken) });
    assert.equal(status.status, 200);
    const statusBody = (await status.json()) as {
      pet: { id: string; displayName: string; actions: number };
      snapshot: { action: string; activity: string };
    };
    assert.deepEqual(statusBody.pet, { id: "clawa", displayName: "Clawa", actions: 9 });
    assert.equal(statusBody.snapshot.action, "idle");
    assert.equal(statusBody.snapshot.activity, "idle");
    assert.equal((await fetch(`${base}/api/v1/catalog`)).status, 401);
    assert.equal((await fetch(`${base}/api/v1/catalog`, { headers: headers(config.displayToken) })).status, 200);
    assert.equal(
      (await fetch(`${base}/api/v1/catalog`, { headers: { ...headers(config.displayToken), origin: base } })).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${base}/api/v1/catalog`, {
          headers: { ...headers(config.displayToken), origin: "http://evil.invalid" },
        })
      ).status,
      403,
    );

    const agentStream = await fetch(`${base}/api/v1/agent/events`, {
      headers: headers(config.agentToken, "session_12345678"),
      signal: agentAbort.signal,
    });
    assert.equal(agentStream.status, 200);
    const secondAgent = await fetch(`${base}/api/v1/agent/events`, {
      headers: headers(config.agentToken, "session_87654321"),
    });
    assert.equal(secondAgent.status, 409);

    const wrongRole = await fetch(`${base}/api/v1/commands`, {
      method: "POST",
      headers: { ...headers(config.displayToken), "content-type": "application/json" },
      body: JSON.stringify({ kind: "state", value: "running" }),
    });
    assert.equal(wrongRole.status, 401);

    const command = await fetch(`${base}/api/v1/commands`, {
      method: "POST",
      headers: { ...headers(config.agentToken, "session_12345678"), "content-type": "application/json" },
      body: JSON.stringify({ kind: "state", value: "running", note: "Testing" }),
    });
    assert.equal(command.status, 200);
    assert.equal(((await command.json()) as { snapshot: { action: string } }).snapshot.action, "running");
    const activityCommand = await fetch(`${base}/api/v1/commands`, {
      method: "POST",
      headers: { ...headers(config.agentToken, "session_12345678"), "content-type": "application/json" },
      body: JSON.stringify({ kind: "activity", value: "working", note: "Thinking" }),
    });
    assert.equal(activityCommand.status, 200);
    const activityBody = (await activityCommand.json()) as {
      requestedAction: string;
      resolvedAction: string;
      snapshot: { action: string; activity: string };
    };
    assert.equal(activityBody.requestedAction, "working");
    assert.equal(activityBody.resolvedAction, "running");
    assert.equal(activityBody.snapshot.action, "running");
    assert.equal(activityBody.snapshot.activity, "working");
    const settledCommand = await fetch(`${base}/api/v1/commands`, {
      method: "POST",
      headers: { ...headers(config.agentToken, "session_12345678"), "content-type": "application/json" },
      body: JSON.stringify({ kind: "activity", value: "settled", note: "Ready" }),
    });
    assert.equal(settledCommand.status, 200);
    assert.equal(((await settledCommand.json()) as { snapshot: { action: string } }).snapshot.action, "review");
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const rested = await fetch(`${base}/api/v1/status`, { headers: headers(config.displayToken) });
    const restedBody = (await rested.json()) as { snapshot: { action: string; activity: string } };
    assert.equal(restedBody.snapshot.activity, "settled");
    assert.equal(restedBody.snapshot.action, "idle");
    const aliasCommand = await fetch(`${base}/api/v1/commands`, {
      method: "POST",
      headers: { ...headers(config.agentToken, "session_12345678"), "content-type": "application/json" },
      body: JSON.stringify({ kind: "state", value: "success" }),
    });
    assert.equal(aliasCommand.status, 200);
    const aliasBody = (await aliasCommand.json()) as {
      requestedAction: string;
      resolvedAction: string;
      snapshot: { action: string };
    };
    assert.deepEqual(aliasBody, {
      requestedAction: "success",
      resolvedAction: "jumping",
      snapshot: aliasBody.snapshot,
      ok: true,
    });
    assert.equal(aliasBody.snapshot.action, "jumping");
    const unknownAction = await fetch(`${base}/api/v1/commands`, {
      method: "POST",
      headers: { ...headers(config.agentToken, "session_12345678"), "content-type": "application/json" },
      body: JSON.stringify({ kind: "state", value: "not-installed" }),
    });
    assert.equal(unknownAction.status, 422);

    const displayStream = await fetch(`${base}/api/v1/events`, {
      headers: headers(config.displayToken),
      signal: displayAbort.signal,
    });
    assert.equal(displayStream.status, 200);

    const prompt = await fetch(`${base}/api/v1/prompts`, {
      method: "POST",
      headers: { ...headers(config.displayToken), "content-type": "application/json" },
      body: JSON.stringify({ text: "Check the tests", device: "desk" }),
    });
    assert.equal(prompt.status, 202);
    const promptBody = (await prompt.json()) as { id: string };
    agentAbort.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const disconnected = await fetch(`${base}/api/v1/catalog`, { headers: headers(config.displayToken) });
    const disconnectedBody = (await disconnected.json()) as {
      snapshot: { action: string; activity: string; agent: { connected: boolean } };
    };
    assert.equal(disconnectedBody.snapshot.action, "idle");
    assert.equal(disconnectedBody.snapshot.activity, "idle");
    assert.equal(disconnectedBody.snapshot.agent.connected, false);

    agentAbort = new AbortController();
    const reconnectedAgentStream = await fetch(`${base}/api/v1/agent/events`, {
      headers: headers(config.agentToken, "session_12345678"),
      signal: agentAbort.signal,
    });
    assert.equal(reconnectedAgentStream.status, 200);
    const event = (await nextEvent(reconnectedAgentStream, "prompt-request")) as { id: string; text: string };
    assert.equal(event.id, promptBody.id);
    assert.equal(event.text, "Check the tests");

    const ack = await fetch(`${base}/api/v1/prompt-acks`, {
      method: "POST",
      headers: { ...headers(config.agentToken, "session_12345678"), "content-type": "application/json" },
      body: JSON.stringify({ id: promptBody.id, accepted: true }),
    });
    assert.equal(ack.status, 200);
    const replayedAck = await fetch(`${base}/api/v1/prompt-acks`, {
      method: "POST",
      headers: { ...headers(config.agentToken, "session_12345678"), "content-type": "application/json" },
      body: JSON.stringify({ id: promptBody.id, accepted: true }),
    });
    assert.equal(replayedAck.status, 404);

    const traversal = await fetch(`${base}/api/v1/assets/..%2Fpet.json`, { headers: headers(config.displayToken) });
    assert.equal(traversal.status, 400);
    const nonImage = await fetch(`${base}/api/v1/assets/pet.json`, { headers: headers(config.displayToken) });
    assert.equal(nonImage.status, 415);
    const oversized = await fetch(`${base}/api/v1/prompts`, {
      method: "POST",
      headers: { ...headers(config.displayToken), "content-type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(17_000), device: "desk" }),
    });
    assert.equal(oversized.status, 400);
    displayAbort.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const noDisplays = await fetch(`${base}/api/v1/catalog`, { headers: headers(config.displayToken) });
    assert.equal(((await noDisplays.json()) as { snapshot: { displays: number } }).snapshot.displays, 0);
    agentAbort.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const orphanPrompt = await fetch(`${base}/api/v1/prompts`, {
      method: "POST",
      headers: { ...headers(config.displayToken), "content-type": "application/json" },
      body: JSON.stringify({ text: "Do not queue this", device: "desk" }),
    });
    assert.equal(orphanPrompt.status, 503);
  } finally {
    displayAbort.abort();
    agentAbort.abort();
    await broker.close();
  }
});
