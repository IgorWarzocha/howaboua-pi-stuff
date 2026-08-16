import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import piPetExtension from "../extensions/index.ts";

test("extension exposes only compact pet controls to the model", () => {
  const registered: ToolDefinition[] = [];
  piPetExtension({
    registerTool(tool: ToolDefinition) {
      registered.push(tool);
    },
    registerCommand() {},
    on() {},
  } as unknown as ExtensionAPI);

  assert.deepEqual(
    registered.map((tool) => tool.name),
    ["pet_show", "pet_reload", "pet_say"],
  );

  const show = registered[0];
  assert.ok(show?.renderCall);
  assert.ok(show.renderResult);
  const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value };
  assert.equal(
    show
      .renderCall({ action: "waving" } as never, theme as never, {} as never)
      .render(80)[0]
      ?.trim(),
    "Pet waving",
  );
  assert.deepEqual(
    show
      .renderResult(
        { content: [{ type: "text", text: "Pet action set to waving." }], details: {} },
        {
          expanded: false,
          isPartial: false,
        },
        theme as never,
        { isError: false } as never,
      )
      .render(80),
    [],
  );
});
