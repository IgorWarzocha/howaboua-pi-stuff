import assert from "node:assert/strict";
import test from "node:test";
import { imagegenCodeModeResult } from "../index.js";
import { formatImagegenOutput } from "../src/output.js";
import { buildImageGenerationRequest } from "../src/request.js";

test("image generation preserves Codex request and Code Mode value contracts", async () => {
	assert.equal(
		formatImagegenOutput({
			path: "output.png",
			latest_path: "latest.png",
		}),
		"Generated image: output.png\nLatest: latest.png",
	);
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
		),
		{
			operation: "generations",
			body: {
				prompt: "draw a fox",
				model: "gpt-image-2",
				background: "auto",
				quality: "auto",
				size: "auto",
			},
		},
	);
	const recent = "data:image/png;base64,aW1hZ2U=";
	assert.deepEqual(
		await buildImageGenerationRequest(
			{
				prompt: "add snow",
				num_last_images_to_include: 1,
			},
			[recent],
			process.cwd(),
		),
		{
			operation: "edits",
			body: {
				images: [{ image_url: recent }],
				prompt: "add snow",
				model: "gpt-image-2",
				background: "auto",
				quality: "auto",
				size: "auto",
			},
		},
	);
});
