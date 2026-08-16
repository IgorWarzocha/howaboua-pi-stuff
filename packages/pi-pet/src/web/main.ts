import type { PiPetDesktopBridge } from "../desktop/bridge.ts";
import { type BrokerSnapshot, type PetAction, type PetCatalog, parseDeviceName } from "../protocol/index.ts";

declare global {
  interface Window {
    piPetDesktop?: PiPetDesktopBridge;
  }
}

interface StreamEvent {
  event: string;
  data: unknown;
}

const LEADING_SPACE_PATTERN = /^ /;
const LOOK_PREFIX_PATTERN = /^look-/;
const desktopShell = new URLSearchParams(location.search).get("shell") === "desktop";
const quietAttention = desktopShell && new URLSearchParams(location.search).get("attention") === "quiet";
const deviceParameter = new URLSearchParams(location.search).get("device");
const desktopDevice = deviceParameter === null ? "desktop" : parseDeviceName(deviceParameter, "desktop device");
document.documentElement.classList.toggle("desktop-shell", desktopShell);

const elements = {
  actionName: required("action-name"),
  actionNote: required("action-note"),
  actionSelect: required<HTMLSelectElement>("action-select"),
  agentState: required("agent-state"),
  bubble: required("bubble"),
  canvas: required<HTMLCanvasElement>("pet-canvas"),
  connectDialog: required<HTMLDialogElement>("connect-dialog"),
  connectError: required("connect-error"),
  connectForm: required<HTMLFormElement>("connect-form"),
  connectionDot: required("connection-dot"),
  connectionLabel: required("connection-label"),
  description: required("pet-description"),
  desktopPromptClose: required<HTMLButtonElement>("desktop-prompt-close"),
  desktopPromptFeedback: required("desktop-prompt-feedback"),
  desktopPromptForm: required<HTMLFormElement>("desktop-prompt-form"),
  desktopPromptSubmit: required<HTMLButtonElement>("desktop-prompt-submit"),
  desktopPromptText: required<HTMLTextAreaElement>("desktop-prompt-text"),
  deviceName: required<HTMLInputElement>("device-name"),
  displayCount: required("display-count"),
  name: required("pet-name"),
  promptFeedback: required("prompt-feedback"),
  promptForm: required<HTMLFormElement>("prompt-form"),
  promptSubmit: required<HTMLButtonElement>("prompt-submit"),
  promptText: required<HTMLTextAreaElement>("prompt-text"),
  quickActions: required("quick-actions"),
  restoreAction: required<HTMLButtonElement>("restore-action"),
  stage: required("stage"),
  token: required<HTMLInputElement>("display-token"),
  wave: required<HTMLButtonElement>("wave-button"),
};

function required<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}

function actionLabel(value: string): string {
  return value.replace(LOOK_PREFIX_PATTERN, "look ").replaceAll("_5", ".5°").replaceAll("-", " ");
}

class PetRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D;
  readonly #images = new Map<string, HTMLImageElement>();
  #catalog: PetCatalog | undefined;
  #action: PetAction | undefined;
  #drawnFrame: PetAction["frames"][number] | undefined;
  #startedAt = performance.now();
  #reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas rendering is unavailable.");
    this.#context = context;
    new ResizeObserver(() => this.#resize()).observe(canvas);
    this.#resize();
  }

  async load(nextCatalog: PetCatalog, displayToken: string): Promise<void> {
    this.#catalog = nextCatalog;
    this.#images.clear();
    const assets = new Set(
      [...Object.values(nextCatalog.actions), ...Object.values(nextCatalog.directions)].map((action) => action.asset),
    );
    await Promise.all(
      [...assets].map(async (asset) => {
        const path = asset.split("/").map(encodeURIComponent).join("/");
        const response = await fetch(`/api/v1/assets/${path}`, {
          headers: authorization(displayToken),
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`Could not load pet asset ${asset}: HTTP ${response.status}`);
        const url = URL.createObjectURL(await response.blob());
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          if (image.naturalWidth * image.naturalHeight > 16_000_000)
            throw new Error(`Pet asset ${asset} exceeds the decoded-pixel limit.`);
          this.#images.set(asset, image);
        } finally {
          URL.revokeObjectURL(url);
        }
      }),
    );
    this.show(nextCatalog.defaultAction);
  }

  show(name: string): void {
    const action = this.#catalog?.actions[name] || this.#catalog?.directions[name];
    if (!action) return;
    this.#action = action;
    this.#startedAt = performance.now();
    this.#drawnFrame = undefined;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#advance();
  }

  #resize(): void {
    const rectangle = this.#canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rectangle.width * ratio));
    const height = Math.max(1, Math.round(rectangle.height * ratio));
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width;
      this.#canvas.height = height;
      const frame = this.#drawnFrame;
      this.#drawnFrame = undefined;
      this.#draw(frame || this.#action?.frames[0]);
    }
  }

  #draw(frame: PetAction["frames"][number] | undefined): void {
    const action = this.#action;
    if (!(frame && action)) return;
    const image = this.#images.get(action.asset);
    if (!image) return;
    const { width, height } = this.#canvas;
    this.#context.clearRect(0, 0, width, height);
    this.#context.imageSmoothingEnabled = true;
    this.#context.imageSmoothingQuality = "high";
    this.#context.drawImage(image, frame.x, frame.y, frame.width, frame.height, 0, 0, width, height);
    this.#drawnFrame = frame;
  }

  #advance = (): void => {
    const action = this.#action;
    if (!action) return;
    let index = 0;
    if (this.#reducedMotion || action.frames.length === 1) {
      this.#draw(action.frames[0]);
      return;
    }
    const total = action.frames.reduce((sum, animationFrame) => sum + animationFrame.durationMs, 0);
    let elapsed = performance.now() - this.#startedAt;
    if (action.loop) elapsed %= total;
    else elapsed = Math.min(elapsed, total - 1);
    let boundary = action.frames[0]?.durationMs || 0;
    while (index < action.frames.length - 1 && elapsed >= boundary) {
      index += 1;
      boundary += action.frames[index]?.durationMs || 0;
    }
    const frame = action.frames[index];
    if (frame !== this.#drawnFrame) this.#draw(frame);
    if (!action.loop && index === action.frames.length - 1) return;
    this.#timer = setTimeout(this.#advance, Math.max(16, boundary - elapsed));
  };
}

const renderer = new PetRenderer(elements.canvas);
let token = "";
let catalog: PetCatalog | undefined;
let snapshot: BrokerSnapshot | undefined;
let previewing = false;
let streamAbort: AbortController | undefined;
let reconnectDelay = 500;
let catalogFingerprint = "";
interface PromptSurface {
  feedback: HTMLElement;
  submit: HTMLButtonElement;
  text: HTMLTextAreaElement;
}

interface PromptAckEvent {
  id: string;
  accepted?: boolean;
  detail?: string;
}

const mainPrompt: PromptSurface = {
  feedback: elements.promptFeedback,
  submit: elements.promptSubmit,
  text: elements.promptText,
};
const desktopPrompt: PromptSurface = {
  feedback: elements.desktopPromptFeedback,
  submit: elements.desktopPromptSubmit,
  text: elements.desktopPromptText,
};
const pendingPrompts = new Map<string, PromptSurface>();
const earlyPromptAcks = new Map<string, PromptAckEvent>();

function authorization(value = token): Record<string, string> {
  return { authorization: `Bearer ${value}` };
}

function tokenFromLocation(): string {
  const params = new URLSearchParams(location.hash.slice(1));
  const value = params.get("token") || sessionStorage.getItem("pi-pet-display-token") || "";
  if (params.has("token")) history.replaceState(null, "", `${location.pathname}${location.search}`);
  return value;
}

function setConnection(online: boolean, label: string): void {
  elements.connectionDot.classList.toggle("online", online);
  elements.connectionLabel.textContent = label;
}

function displayedAction(next: BrokerSnapshot): string {
  if (quietAttention && next.activity === "working" && next.action === "running") {
    return catalog?.defaultAction || next.action;
  }
  return next.action;
}

function updateSnapshot(next: BrokerSnapshot): void {
  snapshot = next;
  if (!previewing) renderer.show(displayedAction(next));
  if (!previewing && [...elements.actionSelect.options].some((option) => option.value === next.action)) {
    elements.actionSelect.value = next.action;
  }
  elements.actionName.textContent = previewing ? `preview · ${elements.actionSelect.value}` : actionLabel(next.action);
  elements.actionNote.textContent = previewing
    ? "Local only — Pi remains in control"
    : next.note || "Following the active Pi session";
  elements.displayCount.textContent = `${next.displays} display${next.displays === 1 ? "" : "s"}`;
  elements.agentState.textContent = next.agent.connected ? "Session online" : "No session";
  elements.promptSubmit.disabled = !next.agent.connected;
  elements.desktopPromptSubmit.disabled = !next.agent.connected;
  if (next.bubble && Date.parse(next.bubble.expiresAt) > Date.now()) {
    elements.bubble.textContent = next.bubble.text;
    elements.bubble.hidden = false;
  } else {
    elements.bubble.hidden = true;
  }
}

function populateActions(next: PetCatalog): void {
  catalog = next;
  elements.name.textContent = next.displayName;
  elements.description.textContent = next.description;
  document.title = `${next.displayName} · Pi Pet`;
  elements.actionSelect.replaceChildren();
  for (const name of Object.keys(next.actions).sort()) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = actionLabel(name);
    elements.actionSelect.append(option);
  }
  elements.quickActions.replaceChildren();
  for (const name of ["idle", "running", "waiting", "review", "failed", "waving", "jumping"]) {
    if (!next.actions[name]) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = actionLabel(name);
    button.addEventListener("click", () => preview(name));
    elements.quickActions.append(button);
  }
}

function preview(name: string): void {
  if (!catalog?.actions[name]) return;
  previewing = true;
  elements.actionSelect.value = name;
  renderer.show(name);
  if (snapshot) updateSnapshot(snapshot);
}

function restore(): void {
  previewing = false;
  if (snapshot) updateSnapshot(snapshot);
}

function parseRecord(record: string): StreamEvent | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of record.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? "" : line.slice(separator + 1).replace(LEADING_SPACE_PATTERN, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return undefined;
  return { event, data: JSON.parse(data.join("\n")) as unknown };
}

async function consumeEvents(response: Response, signal: AbortSignal): Promise<void> {
  if (!response.body) throw new Error("Empty event stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const chunk = await reader.read();
    if (chunk.done) return;
    buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const event = parseRecord(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (event) await handleEvent(event);
      boundary = buffer.indexOf("\n\n");
    }
    if (buffer.length > 65_536) throw new Error("Oversized broker event.");
  }
}

async function handleCatalog(data: unknown): Promise<void> {
  const next = data as PetCatalog;
  const fingerprint = JSON.stringify(next);
  if (fingerprint === catalogFingerprint) return;
  populateActions(next);
  await renderer.load(next, token);
  catalogFingerprint = fingerprint;
}

function applyPromptAck(ack: PromptAckEvent, surface: PromptSurface): void {
  pendingPrompts.delete(ack.id);
  surface.feedback.textContent = ack.accepted ? "Delivered" : ack.detail || "Pi rejected the prompt";
  if (surface === desktopPrompt && ack.accepted) setTimeout(closeDesktopPrompt, 650);
}

function handlePromptAck(data: unknown): void {
  const ack = data as { id?: string; accepted?: boolean; detail?: string };
  if (!ack.id) return;
  const surface = pendingPrompts.get(ack.id);
  if (surface) {
    applyPromptAck({ ...ack, id: ack.id }, surface);
    return;
  }
  earlyPromptAcks.set(ack.id, { ...ack, id: ack.id });
  if (earlyPromptAcks.size > 16) {
    const oldest = earlyPromptAcks.keys().next().value;
    if (oldest) earlyPromptAcks.delete(oldest);
  }
}

async function handleEvent(event: StreamEvent): Promise<void> {
  if (event.event === "catalog") return await handleCatalog(event.data);
  if (event.event === "snapshot") updateSnapshot(event.data as BrokerSnapshot);
  else if (event.event === "prompt-ack") handlePromptAck(event.data);
}

async function waitForEventReconnect(error: unknown, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  setConnection(false, "Reconnecting");
  if (error instanceof Error && error.message.includes("token")) {
    sessionStorage.removeItem("pi-pet-display-token");
    elements.connectError.textContent = error.message;
    elements.connectDialog.showModal();
    return false;
  }
  await new Promise((resolve) => setTimeout(resolve, reconnectDelay));
  reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
  return !signal.aborted;
}

async function eventLoop(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      const response = await fetch("/api/v1/events", { headers: authorization(), signal });
      if (response.status === 401) throw new Error("Display token was rejected.");
      if (!response.ok) throw new Error(`Broker returned HTTP ${response.status}.`);
      setConnection(true, "Live");
      reconnectDelay = 500;
      await consumeEvents(response, signal);
      if (!signal.aborted) throw new Error("Event stream ended.");
    } catch (error) {
      if (!(await waitForEventReconnect(error, signal))) return;
    }
  }
}

async function connect(value: string): Promise<void> {
  const response = await fetch("/api/v1/catalog", {
    headers: authorization(value),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 ? "Display token was rejected." : `Connection failed: HTTP ${response.status}.`,
    );
  const body = (await response.json()) as { catalog: PetCatalog; snapshot: BrokerSnapshot };
  token = value;
  sessionStorage.setItem("pi-pet-display-token", value);
  populateActions(body.catalog);
  await renderer.load(body.catalog, value);
  catalogFingerprint = JSON.stringify(body.catalog);
  updateSnapshot(body.snapshot);
  document.documentElement.dataset["petReady"] = "true";
  streamAbort?.abort();
  streamAbort = new AbortController();
  void eventLoop(streamAbort.signal);
}

elements.actionSelect.addEventListener("change", () => preview(elements.actionSelect.value));
elements.restoreAction.addEventListener("click", restore);
elements.wave.addEventListener("click", () => {
  if (desktopShell) {
    if (elements.desktopPromptForm.hidden) openDesktopPrompt();
    else closeDesktopPrompt();
    return;
  }
  if (!catalog?.actions["waving"]) return;
  renderer.show("waving");
  setTimeout(() => {
    if (!previewing && snapshot) renderer.show(displayedAction(snapshot));
  }, 900);
});

function cursorCanDirectPet(): boolean {
  if (previewing || !snapshot || !catalog) return false;
  if (snapshot.activity === "idle") return snapshot.action === catalog.defaultAction;
  if (snapshot.activity === "working") return snapshot.action === "running";
  if (snapshot.activity === "settled") {
    return snapshot.action === "review" || snapshot.action === catalog.defaultAction;
  }
  return false;
}

function showCursorDirection(x: number, y: number): void {
  if (!cursorCanDirectPet()) return;
  const rectangle = elements.stage.getBoundingClientRect();
  const dx = x - (rectangle.left + rectangle.width / 2);
  const dy = y - (rectangle.top + rectangle.height / 2);
  const distance = Math.hypot(dx, dy);
  const innerRadius = Math.max(45, Math.min(rectangle.width, rectangle.height) * 0.3);
  if (distance < innerRadius) {
    renderer.show(catalog?.defaultAction || "idle");
    return;
  }
  const degrees = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const nearest = (Math.round(degrees / 22.5) % 16) * 22.5;
  const name = `look-${String(nearest).padStart(3, "0").replace(".5", "_5")}`;
  renderer.show(name);
}

function restoreCursorDirection(): void {
  if (!previewing && snapshot) renderer.show(displayedAction(snapshot));
}

if (window.piPetDesktop) {
  window.piPetDesktop.onCursorPosition((position) => {
    if (position) showCursorDirection(position.x, position.y);
    else restoreCursorDirection();
  });
} else {
  elements.stage.addEventListener("pointermove", (event) => showCursorDirection(event.clientX, event.clientY));
  elements.stage.addEventListener("pointerleave", restoreCursorDirection);
}

function openDesktopPrompt(): void {
  elements.desktopPromptForm.hidden = false;
  document.documentElement.classList.add("conversation-open");
  elements.desktopPromptFeedback.textContent = snapshot?.agent.connected ? "" : "Pi is offline";
  elements.desktopPromptText.focus();
}

function closeDesktopPrompt(): void {
  elements.desktopPromptForm.hidden = true;
  document.documentElement.classList.remove("conversation-open");
  elements.desktopPromptFeedback.textContent = "";
}

async function submitPrompt(surface: PromptSurface): Promise<void> {
  const text = surface.text.value.trim();
  if (!(text && snapshot?.agent.connected)) return;
  surface.submit.disabled = true;
  surface.feedback.textContent = "Sending…";
  try {
    const device = desktopShell ? desktopDevice : elements.deviceName.value.trim() || "display";
    const response = await fetch("/api/v1/prompts", {
      method: "POST",
      headers: { ...authorization(), "content-type": "application/json" },
      body: JSON.stringify({ text, device }),
    });
    const body = (await response.json()) as { ok?: boolean; id?: string; error?: string };
    if (!(response.ok && body.id)) throw new Error(body.error || `HTTP ${response.status}`);
    pendingPrompts.set(body.id, surface);
    const earlyAck = earlyPromptAcks.get(body.id);
    if (earlyAck) {
      earlyPromptAcks.delete(body.id);
      applyPromptAck(earlyAck, surface);
    }
    surface.text.value = "";
    if (!earlyAck) surface.feedback.textContent = "Awaiting Pi…";
  } catch (error) {
    surface.feedback.textContent = error instanceof Error ? error.message : "Prompt failed";
  } finally {
    surface.submit.disabled = !snapshot?.agent.connected;
  }
}

elements.promptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitPrompt(mainPrompt);
});

elements.desktopPromptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitPrompt(desktopPrompt);
});
elements.desktopPromptClose.addEventListener("click", closeDesktopPrompt);
elements.desktopPromptText.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeDesktopPrompt();
  } else if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.desktopPromptForm.requestSubmit();
  }
});

elements.connectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.connectError.textContent = "";
  try {
    const device = elements.deviceName.value.trim();
    localStorage.setItem("pi-pet-device-name", device);
    await connect(elements.token.value.trim());
    elements.token.value = "";
    elements.connectDialog.close();
  } catch (error) {
    elements.connectError.textContent = error instanceof Error ? error.message : "Connection failed.";
  }
});

elements.deviceName.value = localStorage.getItem("pi-pet-device-name") || "desk";
if (desktopShell) elements.wave.setAttribute("aria-label", "Talk to Clawa");
token = tokenFromLocation();
if (token) {
  connect(token).catch((error: unknown) => {
    elements.connectError.textContent = error instanceof Error ? error.message : "Connection failed.";
    elements.connectDialog.showModal();
  });
} else {
  setConnection(false, "Token needed");
  elements.connectDialog.showModal();
}
