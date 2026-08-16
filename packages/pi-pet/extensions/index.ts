import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type PetCatalog, type PetState, parseActionName, parseNote } from "../src/protocol/index.ts";
import { registerRemoteDesktops } from "./desktop-command.ts";
import { registerRemoteApp } from "./remote-app.ts";

const appRoot = fileURLToPath(new URL("../dist/web/", import.meta.url));
const catalog = JSON.parse(readFileSync(new URL("../dist/web/catalog.json", import.meta.url), "utf8")) as PetCatalog;

export default function piPetExtension(pi: ExtensionAPI): void {
  registerRemoteDesktops(pi);
  let state: PetState = { schemaVersion: 1, pet: catalog.id, revision: 0, action: catalog.defaultAction };
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
      throw new Error(`Unknown pet action: ${requested}. Load the pi-pet skill for supported actions.`);
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
    promptSnippet: "Show a Pi Pet reaction",
    promptGuidelines: ["Use pet_show sparingly; routine task activity animates automatically"],
    parameters: Type.Object({
      action: Type.String({ minLength: 1, maxLength: 64, description: "Action name from the active pet package" }),
      note: Type.Optional(Type.String({ minLength: 1, maxLength: 280, description: "Short visible context" })),
    }),
    async execute(_toolCallId, params) {
      if (!registration.available) {
        throw new Error("GipPity Control is unavailable. Install it and reload Pi before using pet_show.");
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

  pi.on("session_start", () => {
    state = { schemaVersion: 1, pet: catalog.id, revision: state.revision + 1, action: catalog.defaultAction };
    for (const listener of listeners) listener({ state });
  });
}
