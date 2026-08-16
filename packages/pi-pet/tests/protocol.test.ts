import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ContractError,
  isSafeRelativeAssetPath,
  parseAgentActivity,
  parseDeviceName,
  parsePetCommand,
  parsePromptAck,
  parsePromptSubmission,
} from "../src/protocol/index.ts";

const EMPTY_PATTERN = /cannot be empty/;
const LIMIT_PATTERN = /exceeds 280/;
const UNKNOWN_FIELD_PATTERN = /unknown field/;
const UNSUPPORTED_PATTERN = /unsupported/;

test("pet commands preserve open action strings but reject schema drift", () => {
  assert.deepEqual(parsePetCommand({ kind: "state", value: "celebrate-more", note: "Tests passed" }), {
    kind: "state",
    value: "celebrate-more",
    note: "Tests passed",
  });
  assert.throws(() => parsePetCommand({ kind: "state", value: "Celebrate!" }), ContractError);
  assert.throws(() => parsePetCommand({ kind: "say", value: "hello", html: true }), UNKNOWN_FIELD_PATTERN);
  assert.throws(() => parsePetCommand({ kind: "say", value: "x".repeat(281) }), LIMIT_PATTERN);
  assert.deepEqual(parsePetCommand({ kind: "activity", value: "working", note: "Thinking" }), {
    kind: "activity",
    value: "working",
    note: "Thinking",
  });
  assert.equal(parseAgentActivity("settled"), "settled");
  assert.throws(() => parsePetCommand({ kind: "activity", value: "dancing" }), ContractError);
});

test("prompt submissions are bounded and carry a visible device", () => {
  assert.deepEqual(parsePromptSubmission({ text: "Run the checks", device: "desk" }), {
    text: "Run the checks",
    device: "desk",
  });
  assert.throws(() => parsePromptSubmission({ text: "", device: "desk" }), EMPTY_PATTERN);
  assert.throws(() => parsePromptSubmission({ text: "hello", device: "<script>" }), UNSUPPORTED_PATTERN);
  assert.equal(parseDeviceName("laptop"), "laptop");
  assert.deepEqual(parsePromptAck({ id: "request-1", accepted: false, detail: "session ended" }), {
    id: "request-1",
    accepted: false,
    detail: "session ended",
  });
});

test("asset path policy blocks traversal and platform ambiguity", () => {
  assert.equal(isSafeRelativeAssetPath("sprites/celebrate.webp"), true);
  for (const path of [
    "../secret",
    "sprites/../secret",
    "/tmp/pet.png",
    "sprites\\pet.png",
    "./pet.png",
    "pet//x.png",
  ]) {
    assert.equal(isSafeRelativeAssetPath(path), false, path);
  }
});
