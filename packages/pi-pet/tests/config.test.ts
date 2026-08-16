import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brokerBaseUrl, createConfig, loadConfig, setNetworkMode } from "../src/config.ts";

const ALREADY_EXISTS_PATTERN = /already exists/;

test("setup writes distinct credentials once with private permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-pet-config-"));
  const path = join(root, "nested", "config.json");
  const created = await createConfig(path);
  assert.notEqual(created.agentToken, created.displayToken);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await loadConfig(path), created);
  const before = await readFile(path, "utf8");
  await assert.rejects(createConfig(path), ALREADY_EXISTS_PATTERN);
  assert.equal(await readFile(path, "utf8"), before);
});

test("network mode changes preserve credentials and local control URL", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-pet-network-"));
  const path = join(root, "config.json");
  const created = await createConfig(path);
  const lan = await setNetworkMode("lan", path);
  assert.equal(lan.host, "0.0.0.0");
  assert.equal(lan.agentToken, created.agentToken);
  assert.equal(lan.displayToken, created.displayToken);
  assert.equal(brokerBaseUrl(lan), `http://127.0.0.1:${created.port}`);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await setNetworkMode("loopback", path)).host, "127.0.0.1");
});
