export const GIPPITY_REQUIRED_USER_MESSAGE =
  "Pi Pet requires GipPity Control 0.0.13 or newer. Run: pi install npm:@howaboua/pi-gippity-control — then /reload.";

export const GIPPITY_REQUIRED_TOOL_MESSAGE =
  "GipPity Control 0.0.13 or newer is unavailable. Ask the user to run `pi install npm:@howaboua/pi-gippity-control`, then `/reload`.";

export class GippityUnavailableError extends Error {
  override name = "GippityUnavailableError";

  constructor() {
    super(GIPPITY_REQUIRED_USER_MESSAGE);
  }
}

export function isMissingGippity(error: unknown): boolean {
  if (error instanceof GippityUnavailableError) return true;
  if (!(error instanceof Error)) return false;
  if (error.message.startsWith("GipPity Control is unavailable")) return true;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    (code === "ERR_MODULE_NOT_FOUND" || code === "ERR_PACKAGE_PATH_NOT_EXPORTED") &&
    error.message.includes("@howaboua/pi-gippity-control")
  );
}
