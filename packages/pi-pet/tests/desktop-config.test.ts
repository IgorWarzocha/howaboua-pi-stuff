import assert from "node:assert/strict";
import { chmod, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  parseRemoteDesktopConfig,
  parseSshTarget,
  readRemoteDesktopConfig,
  writeRemoteDesktopConfig,
} from "../extensions/desktop-config.ts";
import { remoteDesktopProcessSpec } from "../extensions/desktop-launcher.ts";
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

const HTTPS_ORIGIN_PATTERN = /HTTPS origin/;
const PATH_PATTERN = /must not contain a path/;
const UNKNOWN_FIELD_PATTERN = /unknown field/;
const PRIVATE_MODE_PATTERN = /mode 0600/;
const SYMBOLIC_LINK_PATTERN = /symbolic link/;
const ATTENTION_MODE_PATTERN = /normal or quiet/;
const ATTENTION_FUTURE_PATTERN = /seven days/;
const UNKNOWN_CURSOR_FIELD_PATTERN = /unknown field/;
const INVALID_CURSOR_PATTERN = /invalid/;
const REMOTE_COPY_PATTERN = /Buffer\.from\(encoded, "base64"\)/;
const REMOTE_INSTALL_PATTERN = /\["install", "--ignore-scripts", "--no-audit", "--no-fund"\]/;
const REMOTE_BUILD_PATTERN = /\["run", "build"\]/;
const SSH_OPTIONS_PATTERN = /without command options/;
const SSH_HELPER_PATTERN = /spawn\("ssh", \[target, "node", "-"\]/;

test("desktop config builds the confined GipPity display URL", () => {
  const config = parseDesktopConfig({ schemaVersion: 1, gippityUrl: "https://192.168.0.113:43120/" });
  const url = new URL(desktopDisplayUrl(config, "normal"));
  assert.equal(url.origin, "https://192.168.0.113:43120");
  assert.equal(url.pathname, "/_gippity/apps/pi-pet/");
  assert.equal(url.searchParams.get("shell"), "desktop");
  assert.equal(url.hash, "");
  assert.equal(new URL(desktopDisplayUrl(config, "quiet")).searchParams.get("attention"), "quiet");
  assert.deepEqual(
    parseRemoteDesktopConfig({ schemaVersion: 1, displays: { desktop: { gippityUrl: config.gippityUrl } } }).displays,
    {
      desktop: { gippityUrl: "https://192.168.0.113:43120" },
    },
  );
  const spec = remoteDesktopProcessSpec("desktop", config.gippityUrl);
  assert.equal(spec.program, "node");
  assert.equal(spec.args[2], "desktop");
  assert.match(spec.args[1], SSH_HELPER_PATTERN);
  assert.match(spec.source, REMOTE_COPY_PATTERN);
  assert.match(spec.source, REMOTE_INSTALL_PATTERN);
  assert.match(spec.source, REMOTE_BUILD_PATTERN);
  assert.throws(() => parseSshTarget("-oProxyCommand=nope"), SSH_OPTIONS_PATTERN);
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

test("desktop config rejects broadened URLs", () => {
  assert.throws(() => parseDesktopConfig({ schemaVersion: 1, gippityUrl: "http://example.com" }), HTTPS_ORIGIN_PATTERN);
  assert.throws(
    () => parseDesktopConfig({ schemaVersion: 1, gippityUrl: "https://127.0.0.1:43120/path" }),
    PATH_PATTERN,
  );
  assert.throws(
    () => parseDesktopConfig({ schemaVersion: 1, gippityUrl: "https://127.0.0.1:43120", extra: true }),
    UNKNOWN_FIELD_PATTERN,
  );
});

test("desktop config loads a bounded local file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-pet-desktop-config-"));
  const path = join(root, "config.json");
  await writeFile(path, JSON.stringify({ schemaVersion: 1, gippityUrl: "https://127.0.0.1:43120" }), { mode: 0o600 });
  assert.equal((await loadDesktopConfig(path, {})).gippityUrl, "https://127.0.0.1:43120");
  const remotePath = join(root, "pi-pet.json");
  await writeRemoteDesktopConfig(
    { schemaVersion: 1, displays: { desktop: { gippityUrl: "https://127.0.0.1:43120" } } },
    remotePath,
  );
  assert.deepEqual((await readRemoteDesktopConfig(remotePath)).displays, {
    desktop: { gippityUrl: "https://127.0.0.1:43120" },
  });
  if (process.platform !== "win32") {
    await chmod(path, 0o644);
    await assert.rejects(loadDesktopConfig(path, {}), PRIVATE_MODE_PATTERN);
    await chmod(path, 0o600);
    const link = join(root, "config-link.json");
    await symlink(path, link);
    await assert.rejects(loadDesktopConfig(link, {}), SYMBOLIC_LINK_PATTERN);
  }
});
