import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { imagegenCodeModeResult } from "../index.js";
import { recentConversationImageUrls } from "../src/history.js";
import { buildImageGenerationRequest } from "../src/request.js";

test("image generation preserves Codex request and Code Mode value contracts", async () => {
	assert.deepEqual(
		imagegenCodeModeResult({
			content: [
				{ type: "text", text: "Generated image: output.png" },
				{
					type: "image",
					data: "aW1hZ2U=",
					mimeType: "image/png",
					detail: "high",
				},
			],
		}),
		{
			image_url: "data:image/png;base64,aW1hZ2U=",
			detail: "high",
			output_hint: "Generated image: output.png",
		},
	);
	assert.deepEqual(
		await buildImageGenerationRequest(
			{ prompt: "draw a fox" },
			undefined,
			process.cwd(),
			"company-image",
		),
		{
			operation: "generations",
			body: {
				prompt: "draw a fox",
				model: "company-image",
				background: "auto",
				quality: "auto",
				size: "auto",
			},
		},
	);
	const recent = "data:image/png;base64,aW1hZ2U=";
	const session = SessionManager.inMemory();
	const image = (data: string) => ({
		type: "image" as const,
		data,
		mimeType: "image/png",
	});
	const replaced = session.appendMessage({
		role: "user",
		content: [image("b2xk")],
		timestamp: 1,
	});
	const omitted = session.appendCustomMessageEntry(
		"image",
		[image("b21pdHRlZA==")],
		false,
	);
	session.appendContextEdit(replaced, { content: [image("aW1hZ2U=")] });
	session.appendContextEdit(omitted, null);
	const selected = recentConversationImageUrls(
		session.buildSessionProjection().messages,
		1,
	);
	assert.deepEqual(selected, [recent]);
	assert.deepEqual(
		await buildImageGenerationRequest(
			{
				prompt: "add snow",
				num_last_images_to_include: 1,
			},
			selected,
			process.cwd(),
		),
		{
			operation: "edits",
			body: {
				images: [{ image_url: recent }],
				prompt: "add snow",
				model: "gpt-image-2.5",
				background: "auto",
				quality: "auto",
				size: "auto",
			},
		},
	);
	const directory = await mkdtemp(join(tmpdir(), "pi-imagegen-validation-"));
	try {
		const malformed = join(directory, "broken.png");
		await writeFile(
			malformed,
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
		);
		await assert.rejects(
			buildImageGenerationRequest(
				{ prompt: "edit", referenced_image_paths: [malformed] },
				undefined,
				process.cwd(),
			),
			/edit image must be PNG, JPEG, GIF, or WebP/,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
