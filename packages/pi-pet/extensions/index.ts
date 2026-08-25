import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import registerPackageChangelog from "../changelog.js";
import { type PetRuntime, resolvePetRuntime } from "../src/pet-storage.ts";
import { type PetCatalog, type PetState, parseActionName, parseNote } from "../src/protocol/index.ts";
import { registerPetDevices } from "./desktop-command.ts";
import { GIPPITY_REQUIRED_TOOL_MESSAGE, GIPPITY_REQUIRED_USER_MESSAGE } from "./gippity.ts";
import { registerRemoteApp } from "./remote-app.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

function registerPetRuntime(pi: ExtensionAPI, runtime: PetRuntime): boolean {
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

  pi.registerTool({
    name: "pet_show",
    label: "Pet",
    description: "Show a named reaction on the connected Pi Pet",
    promptGuidelines: ["Use pet_show sparingly; routine task activity animates automatically"],
    parameters: Type.Object({
      action: Type.String({
        minLength: 1,
        maxLength: 64,
        description: 'Reaction name, or "list" to return available names',
      }),
      note: Type.Optional(Type.String({ minLength: 1, maxLength: 280, description: "Short visible context" })),
    }),
    async execute(_toolCallId, params) {
      if (!registration.available) {
        throw new Error(GIPPITY_REQUIRED_TOOL_MESSAGE);
      }
      if (params.action === "list") {
        const actions = Object.keys(catalog.actions).sort().join(", ");
        const aliases = Object.entries(catalog.aliases)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([alias, target]) => `${alias}=${target}`)
          .join(", ");
        return {
          content: [
            {
              type: "text",
              text: `${catalog.displayName} actions: ${actions}.${aliases ? ` Aliases: ${aliases}.` : ""}`,
            },
          ],
          details: state,
        };
      }
      const next = setAction(params.action, parseNote(params.note));
      return {
        content: [{ type: "text", text: `Pet reaction set to ${next.action}.` }],
        details: next,
      };
    },
    renderCall(args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("Pet"))} ${theme.fg("muted", args.action)}`, 0, 0);
    },
    renderResult(result, _options, theme, renderContext) {
      if (!renderContext.isError) return new Container();
      const message = result.content.find((part) => part.type === "text")?.text || "Pet reaction failed.";
      return new Text(theme.fg("error", message), 0, 0);
    },
  });
  pi.on("agent_settled", () => {
    if (state.action !== catalog.defaultAction) setAction(catalog.defaultAction);
  });
  return registration.available;
}

export default function piPetExtension(pi: ExtensionAPI): void {
  registerPackageChangelog(pi);
  registerPetDevices(pi);
  pi.on("session_start", (_event, ctx) => {
    const resolution = resolvePetRuntime(packageRoot, join(ctx.cwd, CONFIG_DIR_NAME, "pi-pet.json"));
    for (const warning of resolution.warnings) {
      if (ctx.hasUI) ctx.ui.notify(`Pi Pet ${warning}`, "warning");
    }
    const gippityAvailable = registerPetRuntime(pi, resolution.runtime);
    if (!gippityAvailable && ctx.hasUI) ctx.ui.notify(GIPPITY_REQUIRED_USER_MESSAGE, "error");
  });
}
