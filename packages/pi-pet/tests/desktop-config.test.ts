import assert from "node:assert/strict";
import { chmod, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  defaultAttentionPreferences,
  parseAttentionPreferences,
  remainingSnoozeMs,
  snoozeUntilTomorrow,
} from "../src/desktop/attention.ts";
import { parseDesktopCursorPosition } from "../src/desktop/bridge.ts";
import { desktopDisplayUrl, loadDesktopConfig, parseDesktopConfig } from "../src/desktop/config.ts";
import {
  hyprlandCursorSocket,
  parseHyprlandClientBounds,
  parseHyprlandCursorResponse,
  readHyprlandCursor,
} from "../src/desktop/cursor-provider.ts";

const TOKEN = "display-token-that-is-longer-than-32-characters";
const HTTP_ORIGIN_PATTERN = /HTTP origin/;
const PATH_PATTERN = /must not contain a path/;
const UNKNOWN_FIELD_PATTERN = /unknown field/;
const PAIRED_ENV_PATTERN = /must be set together/;
const PRIVATE_MODE_PATTERN = /mode 0600/;
const SYMBOLIC_LINK_PATTERN = /symbolic link/;
const ATTENTION_MODE_PATTERN = /normal or quiet/;
const ATTENTION_FUTURE_PATTERN = /seven days/;
const UNKNOWN_CURSOR_FIELD_PATTERN = /unknown field/;
const INVALID_CURSOR_PATTERN = /invalid/;

test("desktop config builds a same-origin display URL without leaking the token into the query", () => {
  const config = parseDesktopConfig({
    schemaVersion: 1,
    brokerUrl: "http://192.168.0.113:43117/",
    displayToken: TOKEN,
  });
  const url = new URL(desktopDisplayUrl(config, "normal", "laptop"));
  assert.equal(url.origin, "http://192.168.0.113:43117");
  assert.equal(url.searchParams.get("shell"), "desktop");
  assert.equal(url.searchParams.get("device"), "laptop");
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("token"), TOKEN);
  assert.equal(url.searchParams.has("token"), false);
  assert.equal(new URL(desktopDisplayUrl(config, "quiet")).searchParams.get("attention"), "quiet");
});

test("desktop attention preferences are explicit and time bounded", () => {
  assert.deepEqual(defaultAttentionPreferences(), {
    schemaVersion: 1,
    mode: "normal",
    petSize: "medium",
    snoozedUntil: null,
  });
  const preferences = parseAttentionPreferences({
    schemaVersion: 1,
    mode: "quiet",
    petSize: "large",
    snoozedUntil: "2026-07-19T08:00:00.000Z",
  });
  assert.equal(preferences.petSize, "large");
  assert.equal(parseAttentionPreferences({ schemaVersion: 1, mode: "normal", snoozedUntil: null }).petSize, "medium");
  assert.equal(remainingSnoozeMs(preferences, Date.parse("2026-07-19T07:45:00.000Z")), 15 * 60 * 1000);
  assert.equal(snoozeUntilTomorrow(new Date(2026, 6, 18, 22)).getHours(), 8);
  assert.throws(
    () => parseAttentionPreferences({ schemaVersion: 1, mode: "loud", snoozedUntil: null }),
    ATTENTION_MODE_PATTERN,
  );
  assert.throws(
    () =>
      parseAttentionPreferences({
        schemaVersion: 1,
        mode: "quiet",
        snoozedUntil: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ATTENTION_FUTURE_PATTERN,
  );
});

test("desktop cursor bridge accepts only bounded screen positions", () => {
  assert.deepEqual(parseDesktopCursorPosition({ x: -120, y: 340 }), { x: -120, y: 340 });
  assert.equal(parseDesktopCursorPosition(null), null);
  assert.throws(() => parseDesktopCursorPosition({ x: Number.NaN, y: 1 }), INVALID_CURSOR_PATTERN);
  assert.throws(() => parseDesktopCursorPosition({ x: 1, y: 1, code: "nope" }), UNKNOWN_CURSOR_FIELD_PATTERN);
});

test("Hyprland cursor IPC is selected only from a bounded runtime identity", () => {
  assert.equal(
    hyprlandCursorSocket({ XDG_RUNTIME_DIR: "/run/user/1000", HYPRLAND_INSTANCE_SIGNATURE: "instance_123" }),
    "/run/user/1000/hypr/instance_123/.socket.sock",
  );
  assert.equal(
    hyprlandCursorSocket({ XDG_RUNTIME_DIR: "/run/user/1000", HYPRLAND_INSTANCE_SIGNATURE: "../escape" }),
    undefined,
  );
  assert.deepEqual(parseHyprlandCursorResponse('{"x":763,"y":609}'), { x: 763, y: 609 });
  assert.deepEqual(parseHyprlandClientBounds('[{"pid":42,"at":[10,1080],"size":[240,260]}]', 42), {
    x: 10,
    y: 1080,
    width: 240,
    height: 260,
  });
});

test("Hyprland cursor IPC resolves without waiting for the command socket to close", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-pet-hypr-cursor-"));
  const path = join(root, "cursor.sock");
  const server = createServer((socket) => {
    socket.once("data", (request) => {
      assert.equal(request.toString(), "j/cursorpos");
      socket.write('{"x":120,"y":340}');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  try {
    assert.deepEqual(await readHyprlandCursor(path), { x: 120, y: 340 });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("desktop config rejects broadened URLs and partial environment overrides", async () => {
  assert.throws(
    () => parseDesktopConfig({ schemaVersion: 1, brokerUrl: "https://example.com", displayToken: TOKEN }),
    HTTP_ORIGIN_PATTERN,
  );
  assert.throws(
    () => parseDesktopConfig({ schemaVersion: 1, brokerUrl: "http://127.0.0.1:43117/path", displayToken: TOKEN }),
    PATH_PATTERN,
  );
  assert.throws(
    () =>
      parseDesktopConfig({ schemaVersion: 1, brokerUrl: "http://127.0.0.1:43117", displayToken: TOKEN, extra: true }),
    UNKNOWN_FIELD_PATTERN,
  );
  await assert.rejects(loadDesktopConfig("/unused", { PI_PET_DISPLAY_TOKEN: TOKEN }), PAIRED_ENV_PATTERN);
});

test("desktop config loads a bounded local file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-pet-desktop-config-"));
  const path = join(root, "config.json");
  await writeFile(
    path,
    JSON.stringify({ schemaVersion: 1, brokerUrl: "http://127.0.0.1:43117", displayToken: TOKEN }),
    {
      mode: 0o600,
    },
  );
  assert.equal((await loadDesktopConfig(path, {})).brokerUrl, "http://127.0.0.1:43117");
  if (process.platform !== "win32") {
    await chmod(path, 0o644);
    await assert.rejects(loadDesktopConfig(path, {}), PRIVATE_MODE_PATTERN);
    await chmod(path, 0o600);
    const link = join(root, "config-link.json");
    await symlink(path, link);
    await assert.rejects(loadDesktopConfig(link, {}), SYMBOLIC_LINK_PATTERN);
  }
});
