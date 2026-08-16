import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { imageSize } from "../src/pet-image-size.ts";
import { loadPet } from "../src/pet-loader.ts";

const ESCAPES_DIRECTORY_PATTERN = /escapes pet directory/;
const OUTSIDE_PATTERN = /outside/;

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

test("reads PNG and the supplied Clawa WebP dimensions", async () => {
  assert.deepEqual(imageSize(pngHeader(1536, 2288)), { format: "png", width: 1536, height: 2288 });
  const loaded = await loadPet(join(process.cwd(), "pets"), "clawa");
  assert.equal(loaded.catalog.actions["idle"]?.frames.length, 6);
  assert.equal(loaded.catalog.directions["look-337_5"]?.frames[0]?.y, 2080);
  assert.equal(loaded.catalog.aliases["success"], "jumping");
  assert.equal(loaded.catalog.actions["success"], undefined);
});

test("merges bounded custom actions", async () => {
  const { root, pet } = await fixture();
  await writeFile(join(pet, "extra.png"), pngHeader(384, 208));
  await writeFile(
    join(pet, "pet.pi.json"),
    JSON.stringify({
      schemaVersion: 1,
      actions: {
        celebrate: {
          asset: "extra.png",
          frames: [
            { x: 0, y: 0, width: 192, height: 208, durationMs: 120 },
            { x: 192, y: 0, width: 192, height: 208, durationMs: 240 },
          ],
          loop: false,
          next: "idle",
        },
      },
      aliases: { party: "celebrate" },
    }),
  );
  const loaded = await loadPet(root, "clawa");
  assert.equal(loaded.catalog.actions["celebrate"]?.frames.length, 2);
  assert.equal(loaded.catalog.actions["celebrate"]?.next, "idle");
  assert.equal(loaded.catalog.aliases["party"], "celebrate");
});

test("rejects out-of-bounds frames and symlink escapes", async () => {
  const first = await fixture();
  await writeFile(
    join(first.pet, "pet.pi.json"),
    JSON.stringify({
      schemaVersion: 1,
      actions: {
        broken: {
          asset: "spritesheet.png",
          frames: [{ x: 1500, y: 0, width: 192, height: 208, durationMs: 100 }],
          loop: true,
        },
      },
    }),
  );
  await assert.rejects(loadPet(first.root, "clawa"), OUTSIDE_PATTERN);

  const second = await fixture();
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
