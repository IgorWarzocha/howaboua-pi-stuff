import type { PiPetDesktopBridge } from "../desktop/bridge.ts";
import type { PetAction, PetCatalog, PetState } from "../protocol/index.ts";

interface RemoteAudioState {
  active?: boolean;
  busy?: boolean;
  muted?: boolean;
  mode?: "conversation" | "dictation";
  state?: string;
  detail?: string;
}

interface RemoteDraft {
  text: string;
  revision: number;
  selectionStart?: number;
  selectionEnd?: number;
}

interface GippityRemoteClient {
  readonly draft: RemoteDraft;
  readonly audio: {
    readonly state: RemoteAudioState;
    start(mode?: "conversation" | "dictation"): Promise<void>;
    stop(draft?: RemoteDraft): void;
    setMuted(muted: boolean): void;
  };
  on<T>(type: string, listener: (value: T) => void): () => void;
  setDraft(text: string): void;
  send(text?: string): Promise<void>;
}

declare global {
  interface Window {
    GippityRemote?: { connect(): GippityRemoteClient };
    piPetDesktop?: PiPetDesktopBridge;
  }
}

type Activity = "idle" | "working" | "waiting" | "failed" | "settled";
const LOOK_PREFIX_PATTERN = /^look-/;
const desktopShell = new URLSearchParams(location.search).get("shell") === "desktop";
const quietAttention = desktopShell && new URLSearchParams(location.search).get("attention") === "quiet";
document.documentElement.classList.toggle("desktop-shell", desktopShell);

const elements = {
  actionName: required("action-name"),
  actionNote: required("action-note"),
  actionSelect: required<HTMLSelectElement>("action-select"),
  agentState: required("agent-state"),
  bubble: required("bubble"),
  canvas: required<HTMLCanvasElement>("pet-canvas"),
  connectionDot: required("connection-dot"),
  connectionLabel: required("connection-label"),
  description: required("pet-description"),
  desktopPromptClose: required<HTMLButtonElement>("desktop-prompt-close"),
  desktopPromptFeedback: required("desktop-prompt-feedback"),
  desktopPromptForm: required<HTMLFormElement>("desktop-prompt-form"),
  desktopPromptLabel: required("desktop-prompt-label"),
  desktopPromptSubmit: required<HTMLButtonElement>("desktop-prompt-submit"),
  desktopPromptText: required<HTMLTextAreaElement>("desktop-prompt-text"),
  desktopDictation: required<HTMLButtonElement>("desktop-dictation-button"),
  desktopVoice: required<HTMLButtonElement>("desktop-voice-button"),
  name: required("pet-name"),
  promptFeedback: required("prompt-feedback"),
  promptForm: required<HTMLFormElement>("prompt-form"),
  promptSubmit: required<HTMLButtonElement>("prompt-submit"),
  promptText: required<HTMLTextAreaElement>("prompt-text"),
  pointerHint: required("pointer-hint"),
  quickActions: required("quick-actions"),
  restoreAction: required<HTMLButtonElement>("restore-action"),
  stage: required("stage"),
  voice: required<HTMLButtonElement>("voice-button"),
  voiceState: required("voice-state"),
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

  async load(nextCatalog: PetCatalog): Promise<void> {
    this.#catalog = nextCatalog;
    this.#images.clear();
    const assets = new Set(
      [...Object.values(nextCatalog.actions), ...Object.values(nextCatalog.directions)].map(
        (catalogAction) => catalogAction.asset,
      ),
    );
    await Promise.all(
      [...assets].map(async (asset) => {
        const path = asset.split("/").map(encodeURIComponent).join("/");
        const response = await fetch(new URL(path, location.href), { cache: "no-store" });
        if (!response.ok) throw new Error(`Could not load pet asset ${asset}: HTTP ${response.status}`);
        const url = URL.createObjectURL(await response.blob());
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          if (image.naturalWidth * image.naturalHeight > 16_000_000) {
            throw new Error(`Pet asset ${asset} exceeds the decoded-pixel limit.`);
          }
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
    if (this.#reducedMotion || action.frames.length === 1) {
      this.#draw(action.frames[0]);
      return;
    }
    const total = action.frames.reduce((sum, animationFrame) => sum + animationFrame.durationMs, 0);
    let elapsed = performance.now() - this.#startedAt;
    if (action.loop) elapsed %= total;
    else elapsed = Math.min(elapsed, total - 1);
    let index = 0;
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

interface PromptSurface {
  feedback: HTMLElement;
  submit: HTMLButtonElement;
  text: HTMLTextAreaElement;
}

const renderer = new PetRenderer(elements.canvas);
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
const activeTools = new Map<string, string>();
let catalog: PetCatalog;
let remote: GippityRemoteClient;
let connected = false;
let previewing = false;
let activity: Activity = "idle";
let currentAction = "idle";
let currentNote = "Following the active Pi session";
let stateRevision = -1;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let bubbleTimer: ReturnType<typeof setTimeout> | undefined;

function setConnection(online: boolean, label: string): void {
  connected = online;
  elements.connectionDot.classList.toggle("online", online);
  elements.connectionLabel.textContent = label;
  elements.agentState.textContent = online ? "Session online" : "Reconnecting";
  elements.promptSubmit.disabled = !online;
  elements.desktopPromptSubmit.disabled = !online;
  elements.voice.disabled = !online;
  elements.desktopVoice.disabled = !online;
  elements.desktopDictation.disabled = !online;
  if (remote) updateVoice(remote.audio.state);
}

function show(nextAction: string, nextNote: string, nextActivity: Activity): void {
  activity = nextActivity;
  currentAction = quietAttention && nextActivity === "working" ? catalog.defaultAction : nextAction;
  currentNote = nextNote;
  if (!previewing) renderer.show(currentAction);
  elements.actionName.textContent = previewing
    ? `preview · ${elements.actionSelect.value}`
    : actionLabel(currentAction);
  elements.actionNote.textContent = previewing ? "Local preview" : currentNote;
}

function showBubble(text: string): void {
  const bounded = text.replace(/\s+/g, " ").trim().slice(0, 280);
  if (!bounded) return;
  if (bubbleTimer) clearTimeout(bubbleTimer);
  elements.bubble.textContent = bounded;
  elements.bubble.hidden = false;
  bubbleTimer = setTimeout(
    () => {
      elements.bubble.hidden = true;
    },
    Math.min(12_000, Math.max(3_500, bounded.length * 55)),
  );
}

function settle(text?: string): void {
  if (settleTimer) clearTimeout(settleTimer);
  show("review", "Ready", "settled");
  if (text) showBubble(text);
  const duration = catalog.actions["review"]?.frames.reduce((total, frame) => total + frame.durationMs, 0) || 1_000;
  settleTimer = setTimeout(() => show(catalog.defaultAction, "Following the active Pi session", "idle"), duration);
}

function handleActivity(value: { state?: string; text?: string }): void {
  if (value.state === "working") show("running", "Pi is working", "working");
  else if (value.state === "settled") settle(value.text);
  else if (value.state === "idle") show(catalog.defaultAction, "Following the active Pi session", "idle");
}

function toolStarted(value: { toolCallId?: string; toolName?: string }): void {
  if (!(value.toolCallId && value.toolName) || value.toolName === "pet_show") return;
  activeTools.set(value.toolCallId, value.toolName);
  if (value.toolName === "ask") show("waiting", "Waiting for your answer", "waiting");
  else show("running", `Using ${value.toolName}`, "working");
}

function toolEnded(value: { toolCallId?: string; isError?: boolean }): void {
  if (!(value.toolCallId && activeTools.delete(value.toolCallId))) return;
  if (value.isError) show("failed", "A tool failed", "failed");
  else if ([...activeTools.values()].includes("ask")) show("waiting", "Waiting for your answer", "waiting");
  else show("running", "Pi is working", "working");
}

function handlePetState(value: { app?: string; data?: PetState }): void {
  if (
    value.app !== "pi-pet" ||
    value.data?.schemaVersion !== 1 ||
    value.data.pet !== catalog.id ||
    value.data.revision <= stateRevision
  )
    return;
  const next = value.data;
  if (!catalog.actions[next.action]) return;
  stateRevision = next.revision;
  currentAction = next.action;
  currentNote =
    next.note || (next.action === catalog.defaultAction ? "Following the active Pi session" : "Requested by Pi");
  if (!previewing) renderer.show(currentAction);
  elements.actionName.textContent = actionLabel(currentAction);
  elements.actionNote.textContent = currentNote;
}

function populateActions(next: PetCatalog): void {
  catalog = next;
  currentAction = next.defaultAction;
  elements.name.textContent = next.displayName;
  elements.description.textContent = next.description;
  elements.desktopPromptLabel.textContent = `Talk to ${next.displayName}`;
  elements.pointerHint.textContent = `Move nearby. ${next.displayName} is watching.`;
  elements.promptText.placeholder = `Send a thought back through ${next.displayName}…`;
  if (desktopShell) elements.wave.setAttribute("aria-label", `Talk to ${next.displayName}`);
  document.title = `${next.displayName} · Pi Pet`;
  elements.actionSelect.replaceChildren();
  for (const name of Object.keys(next.actions).sort()) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = actionLabel(name);
    elements.actionSelect.append(option);
  }
  elements.actionSelect.value = next.defaultAction;
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
  if (!catalog.actions[name]) return;
  previewing = true;
  elements.actionSelect.value = name;
  renderer.show(name);
  elements.actionName.textContent = `preview · ${actionLabel(name)}`;
  elements.actionNote.textContent = "Local preview";
}

function restore(): void {
  previewing = false;
  show(currentAction, currentNote, activity);
}

function cursorCanDirectPet(): boolean {
  if (previewing) return false;
  if (activity === "idle") return currentAction === catalog.defaultAction;
  if (activity === "working") return currentAction === "running" || currentAction === catalog.defaultAction;
  return activity === "settled" && (currentAction === "review" || currentAction === catalog.defaultAction);
}

function showCursorDirection(x: number, y: number): void {
  if (!cursorCanDirectPet()) return;
  const rectangle = elements.stage.getBoundingClientRect();
  const dx = x - (rectangle.left + rectangle.width / 2);
  const dy = y - (rectangle.top + rectangle.height / 2);
  const distance = Math.hypot(dx, dy);
  const innerRadius = Math.max(45, Math.min(rectangle.width, rectangle.height) * 0.3);
  if (distance < innerRadius) {
    renderer.show(catalog.defaultAction);
    return;
  }
  const degrees = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const nearest = (Math.round(degrees / 22.5) % 16) * 22.5;
  renderer.show(`look-${String(nearest).padStart(3, "0").replace(".5", "_5")}`);
}

function restoreCursorDirection(): void {
  if (!previewing) renderer.show(currentAction);
}

function openDesktopPrompt(): void {
  elements.desktopPromptForm.hidden = false;
  document.documentElement.classList.add("conversation-open");
  elements.desktopPromptFeedback.textContent = connected ? "" : "Pi is reconnecting";
  elements.desktopPromptText.focus();
}

function closeDesktopPrompt(): void {
  elements.desktopPromptForm.hidden = true;
  document.documentElement.classList.remove("conversation-open");
  elements.desktopPromptFeedback.textContent = "";
}

async function submitPrompt(surface: PromptSurface): Promise<void> {
  const text = surface.text.value.trim();
  if (!(text && connected)) return;
  surface.submit.disabled = true;
  surface.feedback.textContent = "Sending…";
  try {
    await remote.send(text);
    surface.text.value = "";
    surface.feedback.textContent = "Delivered";
    if (surface === desktopPrompt) setTimeout(closeDesktopPrompt, 650);
  } catch (error) {
    surface.feedback.textContent = error instanceof Error ? error.message : "Prompt failed";
  } finally {
    surface.submit.disabled = !connected;
  }
}

function updateAudioButton(
  button: HTMLButtonElement,
  buttonMode: "conversation" | "dictation",
  value: RemoteAudioState,
): void {
  const mode = value.mode || "conversation";
  const idleLabel = buttonMode === "conversation" ? "Voice" : "Dictate";
  button.disabled = !connected || ((value.active === true || value.busy === true) && mode !== buttonMode);
  if (mode !== buttonMode) {
    button.textContent = idleLabel;
    return;
  }
  if (value.active) {
    button.textContent = buttonMode === "dictation" ? "Finish" : value.muted ? "Muted" : "Stop voice";
    return;
  }
  button.textContent = value.busy ? "Cancel" : idleLabel;
}

function updateVoice(value: RemoteAudioState): void {
  const active = value.active === true;
  updateAudioButton(elements.voice, "conversation", value);
  updateAudioButton(elements.desktopVoice, "conversation", value);
  updateAudioButton(elements.desktopDictation, "dictation", value);
  elements.voiceState.textContent = value.detail || (active ? value.state || "Voice active" : "Voice idle");
  if (value.state === "error") {
    const message = value.detail || "Voice failed";
    elements.promptFeedback.textContent = message;
    elements.desktopPromptFeedback.textContent = message;
  }
}

function syncDraft(value: { text?: string }): void {
  if (typeof value.text !== "string") return;
  elements.promptText.value = value.text;
  elements.desktopPromptText.value = value.text;
}

function updateLocalDraft(surface: PromptSurface): void {
  if (!remote) return;
  remote.setDraft(surface.text.value);
}

async function toggleAudio(
  mode: "conversation" | "dictation",
  feedback: HTMLElement,
  surface?: PromptSurface,
): Promise<void> {
  try {
    const state = remote.audio.state;
    if (state.active || state.busy) {
      if (state.mode !== mode) return;
      if (mode === "dictation" && surface) {
        remote.audio.stop({
          text: surface.text.value,
          revision: remote.draft.revision,
          selectionStart: surface.text.selectionStart,
          selectionEnd: surface.text.selectionEnd,
        });
      } else remote.audio.stop();
    } else await remote.audio.start(mode);
  } catch (error) {
    feedback.textContent = error instanceof Error ? error.message : "Voice failed";
  }
}

async function start(): Promise<void> {
  const response = await fetch(new URL("catalog.json", location.href), { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load pet catalog: HTTP ${response.status}`);
  populateActions((await response.json()) as PetCatalog);
  await renderer.load(catalog);
  document.documentElement.dataset["petReady"] = "true";
  if (!window.GippityRemote) throw new Error("GipPity Remote SDK is unavailable");
  remote = window.GippityRemote.connect();
  remote.on("connection", (value: { state?: string }) =>
    setConnection(value.state === "connected", value.state === "connected" ? "Live" : "Reconnecting"),
  );
  remote.on("activity", handleActivity);
  remote.on("app.state", handlePetState);
  remote.on("pi:tool_execution_start", toolStarted);
  remote.on("pi:tool_execution_end", toolEnded);
  remote.on("draft", syncDraft);
  remote.on("audio", updateVoice);
  setConnection(false, "Connecting");
}

elements.actionSelect.addEventListener("change", () => preview(elements.actionSelect.value));
elements.restoreAction.addEventListener("click", restore);
elements.wave.addEventListener("click", () => {
  if (desktopShell) {
    if (elements.desktopPromptForm.hidden) openDesktopPrompt();
    else closeDesktopPrompt();
    return;
  }
  renderer.show("waving");
  setTimeout(restoreCursorDirection, 900);
});
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
elements.promptText.addEventListener("input", () => updateLocalDraft(mainPrompt));
elements.desktopPromptText.addEventListener("input", () => updateLocalDraft(desktopPrompt));
elements.voice.addEventListener("click", () => void toggleAudio("conversation", elements.promptFeedback));
elements.desktopVoice.addEventListener("click", () => void toggleAudio("conversation", elements.desktopPromptFeedback));
elements.desktopDictation.addEventListener(
  "click",
  () => void toggleAudio("dictation", elements.desktopPromptFeedback, desktopPrompt),
);

if (window.piPetDesktop) {
  window.piPetDesktop.onCursorPosition((position) => {
    if (position) showCursorDirection(position.x, position.y);
    else restoreCursorDirection();
  });
} else {
  elements.stage.addEventListener("pointermove", (event) => showCursorDirection(event.clientX, event.clientY));
  elements.stage.addEventListener("pointerleave", restoreCursorDirection);
}
start().catch((error: unknown) => {
  setConnection(false, "Unavailable");
  elements.actionNote.textContent = error instanceof Error ? error.message : "Pet failed to start";
});
