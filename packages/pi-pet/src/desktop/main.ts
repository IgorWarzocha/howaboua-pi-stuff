import { createReadStream, type ReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, screen, session } from "electron";
import {
  type AttentionPreferences,
  defaultAttentionPreferences,
  loadAttentionPreferences,
  type PetSize,
  remainingSnoozeMs,
  saveAttentionPreferences,
  snoozeUntilTomorrow,
} from "./attention.ts";
import { DESKTOP_CURSOR_CHANNEL, type DesktopCursorPosition } from "./bridge.ts";
import { type DesktopConfig, desktopDisplayUrl, desktopStateDirectory, loadDesktopConfig } from "./config.ts";
import { createCursorReader, createHyprlandBoundsReader, type DesktopWindowBounds } from "./cursor-provider.ts";

const WINDOW_MARGIN = 20;
const RETRY_DELAY_MS = 3_000;
const SCREENSHOT_DELAY_MS = 1_500;
const CURSOR_POLL_MS = 100;
const CURSOR_PROXIMITY_MARGIN = 220;
const CURSOR_RETRY_MIN_MS = 500;
const CURSOR_RETRY_MAX_MS = 10_000;
const WINDOW_BOUNDS_POLL_MS = 1_000;
const WINDOW_SIZES: Readonly<Record<PetSize, { width: number; height: number }>> = Object.freeze({
  small: { width: 180, height: 195 },
  medium: { width: 240, height: 260 },
  large: { width: 320, height: 347 },
});

let mainWindow: BrowserWindow | undefined;
let retryTimer: NodeJS.Timeout | undefined;
let wakeTimer: NodeJS.Timeout | undefined;
let cursorTimer: NodeJS.Timeout | undefined;
let cursorBoundsTimer: NodeJS.Timeout | undefined;
let desktopConfig: DesktopConfig | undefined;
let attention = defaultAttentionPreferences();
let attentionWrites = Promise.resolve();
let signalShutdownStarted = false;
let ownerPipe: ReadStream | undefined;
let ownerClosing = false;

app.setName("Pi Pet Desktop");
app.setPath("userData", desktopStateDirectory());

if (process.platform === "linux") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
}

function pinWindow(window: BrowserWindow): void {
  const level = process.platform === "darwin" ? "floating" : "screen-saver";
  window.setAlwaysOnTop(true, level, 1);
  window.moveTop();
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function attentionPath(): string {
  return join(app.getPath("userData"), "attention.json");
}

function watchOwner(): void {
  const fd = Number(process.env["PI_PET_OWNER_FD"]);
  if (!Number.isSafeInteger(fd) || fd < 3 || fd > 9) return;
  const ownerGone = () => {
    if (!ownerClosing) app.quit();
  };
  ownerPipe = createReadStream("", { fd, autoClose: false });
  ownerPipe.once("end", ownerGone);
  ownerPipe.once("close", ownerGone);
  ownerPipe.once("error", ownerGone);
  ownerPipe.resume();
}

function currentDisplayUrl(): string {
  if (!desktopConfig) throw new Error("Pi Pet desktop configuration is not loaded.");
  return desktopDisplayUrl(desktopConfig, attention.mode);
}

function updateAttention(update: (current: AttentionPreferences) => AttentionPreferences): Promise<void> {
  const operation = attentionWrites.then(async () => {
    const next = update(attention);
    await saveAttentionPreferences(attentionPath(), next);
    attention = next;
  });
  attentionWrites = operation.catch(() => undefined);
  return operation;
}

function reportDesktopError(error: unknown): void {
  process.stderr.write(`Pi Pet desktop: ${error instanceof Error ? error.message : String(error)}\n`);
}

function isConfiguredGippityOrigin(value: string | undefined): boolean {
  if (!(desktopConfig && value)) return false;
  try {
    return new URL(value).origin === new URL(desktopConfig.gippityUrl).origin;
  } catch {
    return false;
  }
}

function configurePermissions(): void {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return (
      permission === "media" &&
      details.isMainFrame &&
      details.mediaType === "audio" &&
      webContents !== null &&
      isConfiguredGippityOrigin(webContents.getURL()) &&
      isConfiguredGippityOrigin(requestingOrigin)
    );
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
    callback(
      permission === "media" &&
        details.isMainFrame &&
        mediaTypes?.length === 1 &&
        mediaTypes[0] === "audio" &&
        isConfiguredGippityOrigin(webContents.getURL()) &&
        isConfiguredGippityOrigin(details.requestingUrl),
    );
  });
}

function configureCertificateVerification(): void {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const configuredHost = desktopConfig ? new URL(desktopConfig.gippityUrl).hostname : undefined;
    const authorityInvalid =
      request.errorCode === -202 ||
      request.verificationResult === "CERT_AUTHORITY_INVALID" ||
      request.verificationResult === "net::ERR_CERT_AUTHORITY_INVALID";
    callback(request.hostname === configuredHost && authorityInvalid ? 0 : request.errorCode);
  });
}

app.on("certificate-error", (event, _webContents, url, error, _certificate, callback) => {
  try {
    if (
      desktopConfig &&
      error === "net::ERR_CERT_AUTHORITY_INVALID" &&
      new URL(url).origin === new URL(desktopConfig.gippityUrl).origin
    ) {
      event.preventDefault();
      callback(true);
      return;
    }
  } catch {
    // Reject malformed certificate targets below.
  }
  callback(false);
});

function showAwakeWindow(window: BrowserWindow): void {
  if (remainingSnoozeMs(attention) > 0) {
    window.hide();
    return;
  }
  pinWindow(window);
  window.show();
}

function scheduleWake(window: BrowserWindow): void {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = undefined;
  const remaining = remainingSnoozeMs(attention);
  if (remaining === 0) {
    showAwakeWindow(window);
    return;
  }
  window.hide();
  wakeTimer = setTimeout(() => {
    wakeTimer = undefined;
    void updateAttention((current) => ({ ...current, snoozedUntil: null }))
      .then(() => showAwakeWindow(window))
      .catch(reportDesktopError);
  }, remaining);
  wakeTimer.unref();
}

async function snooze(window: BrowserWindow, until: Date): Promise<void> {
  await updateAttention((current) => ({ ...current, snoozedUntil: until.toISOString() }));
  scheduleWake(window);
}

async function setQuietMode(window: BrowserWindow, quiet: boolean): Promise<void> {
  await updateAttention((current) => ({ ...current, mode: quiet ? "quiet" : "normal" }));
  await loadDisplay(window, currentDisplayUrl());
}

async function setPetSize(window: BrowserWindow, petSize: PetSize): Promise<void> {
  await updateAttention((current) => ({ ...current, petSize }));
  const bounds = window.getBounds();
  const next = WINDOW_SIZES[petSize];
  window.setBounds({
    x: bounds.x + bounds.width - next.width,
    y: bounds.y + bounds.height - next.height,
    ...next,
  });
  pinWindow(window);
}

function initialBounds(petSize: PetSize): Electron.Rectangle {
  const workArea = screen.getPrimaryDisplay().workArea;
  const size = WINDOW_SIZES[petSize];
  return {
    x: workArea.x + workArea.width - size.width - WINDOW_MARGIN,
    y: workArea.y + workArea.height - size.height - WINDOW_MARGIN,
    ...size,
  };
}

function startCursorTracking(window: BrowserWindow): void {
  let cursorWasNear = false;
  let reading = false;
  let warned = false;
  let retryDelay = CURSOR_RETRY_MIN_MS;
  let retryAt = 0;
  const readCursor = createCursorReader(process.env, () => screen.getCursorScreenPoint());
  const readHyprlandBounds = createHyprlandBoundsReader(process.env, process.pid);
  let compositorBounds: DesktopWindowBounds | undefined;
  let boundsWarned = false;
  const refreshBounds = async (): Promise<void> => {
    if (!readHyprlandBounds) return;
    try {
      compositorBounds = await readHyprlandBounds();
      boundsWarned = false;
    } catch (error) {
      if (!boundsWarned) {
        boundsWarned = true;
        reportDesktopError(error);
      }
    }
  };
  const publish = async (): Promise<void> => {
    if (reading || Date.now() < retryAt || window.isDestroyed() || remainingSnoozeMs(attention) > 0) return;
    reading = true;
    let cursor: DesktopCursorPosition;
    try {
      cursor = await readCursor();
      warned = false;
      retryDelay = CURSOR_RETRY_MIN_MS;
      retryAt = 0;
    } catch (error) {
      if (!warned) {
        warned = true;
        reportDesktopError(error);
      }
      retryAt = Date.now() + retryDelay;
      retryDelay = Math.min(retryDelay * 2, CURSOR_RETRY_MAX_MS);
      reading = false;
      return;
    }
    const bounds = compositorBounds || window.getBounds();
    const x = cursor.x - bounds.x;
    const y = cursor.y - bounds.y;
    const dx = x - bounds.width / 2;
    const dy = y - bounds.height / 2;
    const radius = Math.max(bounds.width, bounds.height) / 2 + CURSOR_PROXIMITY_MARGIN;
    const near = Math.hypot(dx, dy) <= radius;
    if (near) {
      const position: DesktopCursorPosition = { x, y };
      window.webContents.send(DESKTOP_CURSOR_CHANNEL, position);
    } else if (cursorWasNear) {
      window.webContents.send(DESKTOP_CURSOR_CHANNEL, null);
    }
    cursorWasNear = near;
    reading = false;
  };
  cursorTimer = setInterval(() => void publish(), CURSOR_POLL_MS);
  cursorTimer.unref();
  cursorBoundsTimer = setInterval(() => void refreshBounds(), WINDOW_BOUNDS_POLL_MS);
  cursorBoundsTimer.unref();
  void refreshBounds().then(publish);
}

function secureWebContents(window: BrowserWindow, gippityOrigin: string): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const confineNavigation = (event: Electron.Event, target: string): void => {
    try {
      if (new URL(target).origin !== gippityOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  };
  window.webContents.on("will-navigate", confineNavigation);
  window.webContents.on("will-redirect", confineNavigation);
  window.webContents.on("context-menu", () => {
    Menu.buildFromTemplate([
      { label: "Use arrow keys and Enter", enabled: false },
      { type: "separator" },
      { label: "Reload pet", click: () => window.webContents.reload() },
      {
        label: "Quiet mode",
        type: "checkbox",
        checked: attention.mode === "quiet",
        click: (item) => void setQuietMode(window, item.checked).catch(reportDesktopError),
      },
      {
        label: "Snooze",
        submenu: [
          {
            label: "For 15 minutes",
            click: () => void snooze(window, new Date(Date.now() + 15 * 60 * 1000)).catch(reportDesktopError),
          },
          {
            label: "For 1 hour",
            click: () => void snooze(window, new Date(Date.now() + 60 * 60 * 1000)).catch(reportDesktopError),
          },
          {
            label: "Until tomorrow",
            click: () => void snooze(window, snoozeUntilTomorrow()).catch(reportDesktopError),
          },
        ],
      },
      {
        label: "Pet size",
        submenu: (["small", "medium", "large"] as const).map((petSize) => ({
          label: petSize[0]?.toUpperCase() + petSize.slice(1),
          type: "radio" as const,
          checked: attention.petSize === petSize,
          click: () => void setPetSize(window, petSize).catch(reportDesktopError),
        })),
      },
      { type: "separator" },
      { label: "Quit for this Pi session", click: () => app.quit() },
    ]).popup({ window });
  });
}

async function captureAndQuit(window: BrowserWindow, path: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, SCREENSHOT_DELAY_MS));
  const image = await window.capturePage();
  await writeFile(path, image.toPNG());
  app.quit();
}

function scheduleLoad(window: BrowserWindow, url: string): void {
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void loadDisplay(window, url);
  }, RETRY_DELAY_MS);
  retryTimer.unref();
}

async function loadDisplay(window: BrowserWindow, url: string): Promise<void> {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = undefined;
  try {
    await window.loadURL(url);
    if (window.isDestroyed()) return;
    showAwakeWindow(window);
    const screenshotPath = process.env["PI_PET_DESKTOP_SCREENSHOT"];
    if (screenshotPath) await captureAndQuit(window, screenshotPath);
  } catch (error) {
    if (window.isDestroyed()) return;
    process.stderr.write(
      `Pi Pet desktop could not reach GipPity: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    scheduleLoad(window, url);
  }
}

async function createWindow(): Promise<BrowserWindow> {
  desktopConfig = await loadDesktopConfig();
  attention = await loadAttentionPreferences(attentionPath());
  const url = currentDisplayUrl();
  const gippityOrigin = new URL(url).origin;
  const window = new BrowserWindow({
    ...initialBounds(attention.petSize),
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    maximizable: false,
    minimizable: false,
    movable: true,
    resizable: false,
    show: false,
    skipTaskbar: true,
    title: "Pi Pet",
    webPreferences: {
      contextIsolation: true,
      devTools: process.env["PI_PET_DESKTOP_DEVTOOLS"] === "1",
      nodeIntegration: false,
      preload: join(dirname(fileURLToPath(import.meta.url)), "preload.cjs"),
      sandbox: true,
      webSecurity: true,
    },
  });
  secureWebContents(window, gippityOrigin);
  pinWindow(window);
  window.setFullScreenable(false);
  window.on("blur", () => pinWindow(window));
  window.on("show", () => pinWindow(window));
  window.on("closed", () => {
    if (retryTimer) clearTimeout(retryTimer);
    if (wakeTimer) clearTimeout(wakeTimer);
    if (cursorTimer) clearInterval(cursorTimer);
    if (cursorBoundsTimer) clearInterval(cursorBoundsTimer);
    retryTimer = undefined;
    wakeTimer = undefined;
    cursorTimer = undefined;
    cursorBoundsTimer = undefined;
    if (mainWindow === window) mainWindow = undefined;
  });
  void loadDisplay(window, url);
  startCursorTracking(window);
  if (remainingSnoozeMs(attention) > 0) scheduleWake(window);
  return window;
}

app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null);
    watchOwner();
    configurePermissions();
    configureCertificateVerification();
    mainWindow = await createWindow();
    app.on("activate", () => {
      if (!mainWindow) {
        void createWindow().then((window) => {
          mainWindow = window;
        });
      }
    });
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  ownerClosing = true;
  ownerPipe?.destroy();
  ownerPipe = undefined;
});

async function shutdownForSignal(): Promise<void> {
  if (signalShutdownStarted) return;
  signalShutdownStarted = true;
  const forcedExit = setTimeout(() => process.exit(0), 1_500);
  forcedExit.unref();
  await attentionWrites;
  app.quit();
}

process.once("SIGINT", () => void shutdownForSignal());
process.once("SIGTERM", () => void shutdownForSignal());
