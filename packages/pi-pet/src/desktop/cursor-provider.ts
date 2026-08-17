import { createConnection } from "node:net";
import { join } from "node:path";
import { type DesktopCursorPosition, parseDesktopCursorPosition } from "./bridge.ts";

const HYPRLAND_SIGNATURE_PATTERN = /^[a-zA-Z0-9._-]{1,200}$/;
const MAX_CURSOR_RESPONSE_BYTES = 1_024;
const MAX_CLIENTS_RESPONSE_BYTES = 1024 * 1024;
const CURSOR_TIMEOUT_MS = 200;

export interface DesktopWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function hyprlandCursorSocket(env: NodeJS.ProcessEnv): string | undefined {
  const runtime = env["XDG_RUNTIME_DIR"];
  const signature = env["HYPRLAND_INSTANCE_SIGNATURE"];
  if (!(runtime && signature && runtime.startsWith("/") && HYPRLAND_SIGNATURE_PATTERN.test(signature)))
    return undefined;
  return join(runtime, "hypr", signature, ".socket.sock");
}

export function parseHyprlandCursorResponse(value: string): DesktopCursorPosition {
  const position = parseDesktopCursorPosition(JSON.parse(value) as unknown);
  if (!position) throw new Error("Hyprland returned an empty cursor position.");
  return position;
}

function parseCoordinatePair(value: unknown, label: string): [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== "number" ||
    !Number.isFinite(value[0]) ||
    typeof value[1] !== "number" ||
    !Number.isFinite(value[1])
  ) {
    throw new Error(`Hyprland ${label} is invalid.`);
  }
  return [value[0], value[1]];
}

export function parseHyprlandClientBounds(value: string, pid: number): DesktopWindowBounds {
  const clients = JSON.parse(value) as unknown;
  if (!Array.isArray(clients)) throw new Error("Hyprland clients response must be an array.");
  const client = clients.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>)["pid"] === pid,
  );
  if (!client) throw new Error(`Hyprland did not report the Pi Pet window for process ${pid}.`);
  const input = client as Record<string, unknown>;
  const [x, y] = parseCoordinatePair(input["at"], "window position");
  const [width, height] = parseCoordinatePair(input["size"], "window size");
  if (width < 1 || height < 1 || width > 4_096 || height > 4_096) throw new Error("Hyprland window size is invalid.");
  return { x, y, width, height };
}

async function readHyprlandCommand<T>(
  path: string,
  command: string,
  maximumBytes: number,
  responseComplete: (response: string) => boolean,
  parse: (response: string) => T,
): Promise<T> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let response = "";
    let completed = false;
    const fail = (error: Error): void => {
      if (completed) return;
      completed = true;
      socket.destroy();
      reject(error);
    };
    socket.setEncoding("utf8");
    socket.setTimeout(CURSOR_TIMEOUT_MS);
    socket.on("connect", () => socket.end(command));
    socket.on("data", (chunk: string) => {
      response += chunk;
      if (Buffer.byteLength(response) > maximumBytes) {
        fail(new Error("Hyprland returned an oversized IPC response."));
        return;
      }
      if (!responseComplete(response.trimEnd())) return;
      try {
        const result = parse(response);
        completed = true;
        socket.destroy();
        resolve(result);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Hyprland returned an invalid IPC response."));
      }
    });
    socket.on("timeout", () => fail(new Error("Hyprland cursor IPC timed out.")));
    socket.on("error", (error) => fail(error));
    socket.on("end", () => {
      if (completed) return;
      try {
        const result = parse(response);
        completed = true;
        resolve(result);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Hyprland returned an invalid IPC response."));
      }
    });
  });
}

export async function readHyprlandCursor(path: string): Promise<DesktopCursorPosition> {
  return await readHyprlandCommand(
    path,
    "j/cursorpos",
    MAX_CURSOR_RESPONSE_BYTES,
    (response) => response.endsWith("}"),
    parseHyprlandCursorResponse,
  );
}

async function readHyprlandClientBounds(path: string, pid: number): Promise<DesktopWindowBounds> {
  return await readHyprlandCommand(
    path,
    "j/clients",
    MAX_CLIENTS_RESPONSE_BYTES,
    (response) => response.endsWith("]"),
    (response) => parseHyprlandClientBounds(response, pid),
  );
}

export function createCursorReader(
  env: NodeJS.ProcessEnv,
  fallback: () => DesktopCursorPosition,
): () => Promise<DesktopCursorPosition> {
  const socket = hyprlandCursorSocket(env);
  if (socket) return async () => await readHyprlandCursor(socket);
  return async () => fallback();
}

export function createHyprlandBoundsReader(
  env: NodeJS.ProcessEnv,
  pid: number,
): (() => Promise<DesktopWindowBounds>) | undefined {
  const socket = hyprlandCursorSocket(env);
  if (!socket) return undefined;
  return async () => await readHyprlandClientBounds(socket, pid);
}
