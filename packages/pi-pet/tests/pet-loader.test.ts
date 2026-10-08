import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadPet } from "../src/pet-loader.ts";

const ESCAPES_DIRECTORY_PATTERN = /escapes pet directory/;

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

async function fixture(): Promise<{ root: string; pet: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi-pet-loader-"));
  const pet = join(root, "clawa");
  await mkdir(pet);
  await writeFile(
    join(pet, "pet.json"),
    JSON.stringify({
      id: "clawa",
      displayName: "Clawa",
      description: "Test pet.",
      spriteVersionNumber: 2,
      spritesheetPath: "spritesheet.png",
    }),
  );
  await writeFile(join(pet, "spritesheet.png"), pngHeader(1536, 2288));
  return { root, pet };
}

test("rejects overlay assets escaping through symlinks", async (t) => {
  const second = await fixture();
  t.after(() => rm(second.root, { recursive: true, force: true }));
  const outside = join(second.root, "outside.png");
  await writeFile(outside, pngHeader(192, 208));
  await symlink(outside, join(second.pet, "escape.png"));
  await writeFile(
    join(second.pet, "pet.pi.json"),
    JSON.stringify({
      schemaVersion: 1,
      actions: {
        escaped: {
          asset: "escape.png",
          frames: [{ x: 0, y: 0, width: 192, height: 208, durationMs: 100 }],
          loop: true,
        },
      },
    }),
  );
  await assert.rejects(loadPet(second.root, "clawa"), ESCAPES_DIRECTORY_PATTERN);
});
