export const DESKTOP_CURSOR_CHANNEL = "pi-pet:cursor-position";

export interface DesktopCursorPosition {
  x: number;
  y: number;
}

export interface PiPetDesktopBridge {
  onCursorPosition(listener: (position: DesktopCursorPosition | null) => void): () => void;
}

export function parseDesktopCursorPosition(value: unknown): DesktopCursorPosition | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Cursor position must be an object.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "x" && key !== "y")) {
    throw new Error("Cursor position has an unknown field.");
  }
  if (
    typeof input["x"] !== "number" ||
    !Number.isFinite(input["x"]) ||
    Math.abs(input["x"]) > 100_000 ||
    typeof input["y"] !== "number" ||
    !Number.isFinite(input["y"]) ||
    Math.abs(input["y"]) > 100_000
  ) {
    throw new Error("Cursor position is invalid.");
  }
  return { x: input["x"], y: input["y"] };
}
