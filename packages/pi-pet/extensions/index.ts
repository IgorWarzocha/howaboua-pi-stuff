import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import registerPackageChangelog from "../changelog.js";
import { type PetRuntime, resolvePetRuntime } from "../src/pet-storage.ts";
import { type PetCatalog, type PetState, parseActionName, parseNote } from "../src/protocol/index.ts";
import { registerPetDevices } from "./desktop-command.ts";
import { GIPPITY_REQUIRED_TOOL_MESSAGE, GIPPITY_REQUIRED_USER_MESSAGE } from "./gippity.ts";
import { registerRemoteApp } from "./remote-app.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

function registerPetRuntime(pi: ExtensionAPI, runtime: PetRuntime) {
  const appRoot = runtime.root;
  const catalog: PetCatalog = runtime.catalog;
  let state: PetState = { schemaVersion: 1, pet: catalog.id, revision: 1, action: catalog.defaultAction };
  const listeners = new Set<(update: { state: PetState }) => void>();
  const registration = registerRemoteApp(pi, {
    id: "pi-pet",
    root: appRoot,
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  function setAction(action: string, note?: string): PetState {
    const requested = parseActionName(action);
    const resolved = catalog.actions[requested] ? requested : catalog.aliases[requested];
    if (!(resolved && catalog.actions[resolved])) {
      throw new Error(`Unknown pet action: ${requested}. Call pet_show with action "list", then retry.`);
    }
    state = {
      schemaVersion: 1,
      pet: catalog.id,
      revision: state.revision + 1,
      action: resolved,
      ...(note ? { note } : {}),
    };
    for (const listener of listeners) listener({ state });
    return state;
  }

  const tool = defineTool({
    name: "pet_show",
    label: "Pet",
    description: "Show a named reaction on the connected Pi Pet",
    promptGuidelines: ["Use pet_show sparingly; routine task activity animates automatically"],
    parameters: Type.Object({
      action: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 64,
          description: 'Reaction name, or "list" to return available names',
        }),
      ),
      note: Type.Optional(Type.String({ minLength: 1, maxLength: 280, description: "Short visible context" })),
    }),
    async execute(_toolCallId, params) {
      if (params.action === undefined || params.action === "list") {
        const actions = Object.keys(catalog.actions).sort().join(", ");
        const aliases = Object.entries(catalog.aliases)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([alias, target]) => `${alias}=${target}`)
          .join(", ");
        return {
          content: [
            {
              type: "text",
              text: `${params.action === undefined ? 'pet_show({ action: "<reaction>", note?: "<short context>" }). ' : ""}${catalog.displayName} actions: ${actions}.${aliases ? ` Aliases: ${aliases}.` : ""}`,
            },
          ],
          details: state,
        };
      }
      if (!registration.available) {
        throw new Error(GIPPITY_REQUIRED_TOOL_MESSAGE);
      }
      const next = setAction(params.action, parseNote(params.note));
      return {
        content: [{ type: "text", text: `Pet reaction set to ${next.action}.` }],
        details: next,
      };
    },
    renderCall(args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("Pet"))} ${theme.fg("muted", args.action ?? "help")}`, 0, 0);
    },
    renderResult(result, _options, theme, renderContext) {
      if (!renderContext.isError) return new Container();
      const message = result.content.find((part) => part.type === "text")?.text || "Pet reaction failed.";
      return new Text(theme.fg("error", message), 0, 0);
    },
  });
  pi.registerTool(tool);
  pi.on("agent_settled", () => {
    if (state.action !== catalog.defaultAction) setAction(catalog.defaultAction);
  });
  return { available: registration.available, tool };
}

export default async function piPetExtension(pi: ExtensionAPI): Promise<void> {
  let current: ReturnType<typeof registerPetRuntime> | undefined;
  let refresh = () => {};
  try {
    const { adaptToolForCodeMode, registerCodeModeExtensionTools } = await import(
      "@howaboua/pi-codex-conversion/code-mode"
    );
    const codeRegistration = registerCodeModeExtensionTools(pi, () => [
      ...(current ? [adaptToolForCodeMode(current.tool, { discovery: "help", deferLoading: true })] : []),
    ]);
    refresh = codeRegistration.refresh;
    pi.on("session_shutdown", () => codeRegistration.unregister());
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        ["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"].includes(String(error.code)) &&
        error.message.includes("@howaboua/pi-codex-conversion")
      )
    )
      throw error;
  }

  registerPackageChangelog(pi);
  registerPetDevices(pi);
  pi.on("session_start", (_event, ctx) => {
    const resolution = resolvePetRuntime(packageRoot, join(ctx.cwd, CONFIG_DIR_NAME, "pi-pet.json"));
    for (const warning of resolution.warnings) {
      if (ctx.hasUI) ctx.ui.notify(`Pi Pet ${warning}`, "warning");
    }
    current = registerPetRuntime(pi, resolution.runtime);
    refresh();
    if (!current.available && ctx.hasUI) ctx.ui.notify(GIPPITY_REQUIRED_USER_MESSAGE, "error");
  });
}
