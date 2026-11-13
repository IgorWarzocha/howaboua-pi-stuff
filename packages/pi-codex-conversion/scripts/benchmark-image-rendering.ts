import { initTheme, ToolExecutionComponent, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { setCapabilities, setCellDimensions, Text, TuiMainScreen, type Terminal, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { createImageGenerationTool } from "../../pi-codex-imagegen/src/tool.ts";
import { ActivityTimeline } from "../../pi-chill/src/activity/timeline.ts";
import { ActivityRenderers } from "../../pi-chill/src/rendering/tools.ts";
import { toNestedTool } from "../src/adapter/code-mode/nested-tool-adapter.ts";
import { renderTextAndImages, type RenderedImage } from "../src/tools/code-mode/render-content.ts";
import { createCodeModeRenderTracker } from "../src/tools/code-mode/render-tracker.ts";
import { renderTrackedCodeModeResult } from "../src/tools/code-mode/result-rendering.ts";
import { CodeModeNestedRenderStore } from "../src/tools/code-mode/trace-render-state.ts";
import type { RuntimeToolResult, RuntimeToolTrace } from "../src/tools/code-mode/types.ts";
import { createViewImageTool } from "../src/tools/view-image/tool.ts";
import { auxiliaryToolRenderers } from "../src/ui/tool-rendering/auxiliary-tool.ts";
import { imageFixture } from "./image-rendering/fixture.ts";

// Repository-only: bun packages/pi-codex-conversion/scripts/benchmark-image-rendering.ts --verify
// Run in a dedicated process: capabilities are global. Programmatic rendering, not live TUI acceptance.
initTheme("dark");
setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
setCellDimensions({ widthPx: 8, heightPx: 16 });
const terminal: Terminal = {
	columns: 100, rows: 40, kittyProtocolActive: false,
	start() {}, stop() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {},
	async drainInput() {},
	clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
};
const ui = new TuiMainScreen(terminal);
const image = { type: "image" as const, mimeType: "image/png", data: imageFixture() };
const text = { type: "text" as const, text: "Image result\n".repeat(10).trim() };
const result: RuntimeToolResult = { content: [text, image], details: {} };
const theme = { fg: (_role: string, value: string) => value, bold: (value: string) => value };
const verify = process.argv.includes("--verify");
const widths = [40, 100];
let ordinal = 0;

function ids(lines: string[]): number[] {
	return [...new Set([...lines.join("\n").matchAll(/\x1b_G[^;]*\bi=(\d+)/g)].map((match) => Number(match[1])))];
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)]!;
}

function measure(work: () => void, count = 20): number {
	for (let i = 0; i < 3; i++) work();
	const samples: number[] = [];
	for (let sample = 0; sample < 5; sample++) {
		const start = performance.now();
		for (let i = 0; i < count; i++) work();
		samples.push((performance.now() - start) / count);
	}
	return median(samples);
}

interface Mode {
	name: string;
	kind: "view" | "imagegen" | "nested" | "description" | "auxiliary";
	emitted?: boolean;
	custom?: boolean;
	showImages?: boolean;
	details?: boolean;
	minimal?: boolean;
	chill?: boolean;
	generated?: boolean;
	calls?: number;
}

function makeRow(mode: Mode, store = new CodeModeNestedRenderStore(), activity?: ActivityRenderers, leafResult = result) {
	const id = `bench-image-${ordinal++}`;
	let details = mode.details ?? true;
	let minimal = mode.minimal ?? false;
	let chill = mode.chill ?? false;
	const custom = mode.custom ?? true;
	const view = createViewImageTool({ customRendering: custom });
	let renderer: ToolRenderers = view;
	let output = leafResult;
	if (mode.kind === "imagegen") renderer = createImageGenerationTool({ customRendering: custom });
	if (mode.kind === "auxiliary") renderer = auxiliaryToolRenderers("Failed", () => ({ active: "Reading", complete: "Read" }));
	if (mode.kind === "description") {
		output = { content: [text], details: { viewImageDescription: { image: { ...image, detail: "high" } } } };
	}
	if (mode.kind === "nested") {
		const tool = mode.generated ? toNestedTool(createImageGenerationTool({ customRendering: custom }), "imagegen") : toNestedTool(view, "view_image");
		const traces: RuntimeToolTrace[] = Array.from({ length: mode.calls ?? 1 }, (_, index) => ({ id: `${id}:trace:${index}`, name: tool.name, input: { path: "image.png" }, status: "done", result: leafResult }));
		if (custom) for (const trace of traces) store.captureResult(trace.id, leafResult);
		output = { content: mode.emitted ? [text, image] : [text], details: { status: "result", statusPrefix: false, traces } };
		const tracker = createCodeModeRenderTracker();
		renderer = {
			renderCall: () => new Text("exec", 0, 0),
			renderResult: (value, options, colors, context) => renderTrackedCodeModeResult(value, options, colors, context, tracker, store, [tool], details, minimal),
		};
	}
	if (mode.chill) {
		const timeline = new ActivityTimeline();
		timeline.beginRun();
		renderer = (activity ?? new ActivityRenderers(timeline, () => chill)).resolve(mode.kind, renderer);
	}
	const row = new ToolExecutionComponent(mode.kind, id, { path: "image.png" }, { showImages: mode.showImages ?? true }, renderer, ui, process.cwd());
	row.markExecutionStarted();
	row.setArgsComplete();
	row.updateResult({ ...output, isError: false }, false);
	return {
		row,
		settings() { details = !details; minimal = !minimal; row.invalidate(); },
		chill() { chill = !chill; row.invalidate(); },
	};
}

const modes: Mode[] = [
	{ name: "native-view", kind: "view" },
	{ name: "native-imagegen", kind: "imagegen" },
	{ name: "native-generic", kind: "view", custom: false },
	{ name: "native-hidden", kind: "view", showImages: false },
	{ name: "imagegen-hidden", kind: "imagegen", showImages: false },
	{ name: "native-auxiliary", kind: "auxiliary" },
	{ name: "description", kind: "description" },
	{ name: "description-hidden", kind: "description", showImages: false },
	{ name: "nested-trace", kind: "nested" },
	{ name: "nested-emitted", kind: "nested", emitted: true },
	{ name: "nested-generic", kind: "nested", custom: false },
	{ name: "nested-generic-emitted", kind: "nested", custom: false, emitted: true },
	{ name: "nested-hidden", kind: "nested", showImages: false },
	{ name: "nested-hidden-emitted", kind: "nested", showImages: false, emitted: true },
	{ name: "nested-minimal", kind: "nested", emitted: true, minimal: true },
	{ name: "nested-no-details", kind: "nested", emitted: true, details: false },
	{ name: "nested-imagegen", kind: "nested", generated: true },
	{ name: "nested-imagegen-emitted", kind: "nested", generated: true, emitted: true },
	{ name: "nested-identical-calls", kind: "nested", calls: 2, emitted: true },
	{ name: "chill-native", kind: "view", chill: true },
	{ name: "chill-nested", kind: "nested", emitted: true, chill: true },
];

const failures: string[] = [];
const cases = modes.flatMap((mode) => widths.map((width) => {
	const { row, settings, chill } = makeRow(mode);
	const initial = ids(row.render(width));
	const expected = mode.showImages === false ? 0 : mode.calls ?? 1;
	const counts = [initial.length];
	const seen = new Set(initial);
	const capture = () => {
		const current = ids(row.render(width));
		counts.push(current.length);
		for (const value of current) seen.add(value);
	};
	for (let i = 0; i < 4; i++) {
		row.setExpanded(i % 2 === 0);
		capture();
	}
	const height = row.render(width).length;
	const mouse: TuiMouseEvent = { type: "click", button: "left", x: 2, y: 2, screenX: 2, screenY: 2, width, height, shift: false, alt: false, ctrl: false };
	let clicked = false;
	for (let y = 1; y < Math.min(height, 8) && !clicked; y++) clicked = Boolean(row.handleMouse({ ...mouse, y, screenY: y })?.handled);
	capture();
	if (mode.kind === "nested") { settings(); capture(); settings(); }
	if (mode.chill) { chill(); capture(); chill(); }
	for (const resized of [40, 100, width]) {
		const current = ids(row.render(resized));
		counts.push(current.length);
		for (const value of current) seen.add(value);
	}
	if (counts.some((count) => count !== expected)) failures.push(`${mode.name}@${width}: image counts ${counts}, expected ${expected}`);
	if (seen.size !== expected) failures.push(`${mode.name}@${width}: expansion used ${seen.size} image IDs, expected ${expected}`);
	if (!clicked) failures.push(`${mode.name}@${width}: no clickable detail region`);
	row.setShowImages(false);
	const hiddenCount = ids(row.render(width)).length;
	row.setShowImages(mode.showImages ?? true);
	const restoredCount = ids(row.render(width)).length;
	if (hiddenCount !== 0 || restoredCount !== expected) failures.push(`${mode.name}@${width}: image visibility toggle ${hiddenCount}→${restoredCount}, expected 0→${expected}`);
	let expanded = false;
	const warmMs = measure(() => { row.render(width); });
	const toggleMs = measure(() => { expanded = !expanded; row.setExpanded(expanded); row.render(width); });
	const invalidateMs = measure(() => { row.invalidate(); row.render(width); });
	return { name: mode.name, width, imageCounts: counts, imageIdsAcrossExpansion: seen.size, clicked, hiddenCount, restoredCount, warmMs, toggleMs, invalidateMs };
}));

const history = [25, 100, 400].map((count) => {
	const store = new CodeModeNestedRenderStore();
	const rows = Array.from({ length: count }, () => makeRow({ name: "history", kind: "nested", emitted: true }, store).row);
	for (const row of rows) row.render(100);
	let expanded = false;
	const toggleMs = measure(() => {
		expanded = !expanded;
		for (const row of rows) { row.setExpanded(expanded); row.render(100); }
	}, 3);
	return { rows: count, toggleMs, usPerRow: toggleMs * 1000 / count };
});

const chillHistory = [25, 100, 400].map((count) => {
	const store = new CodeModeNestedRenderStore();
	const timeline = new ActivityTimeline();
	timeline.beginRun();
	const activity = new ActivityRenderers(timeline);
	const rows = Array.from({ length: count }, () => makeRow({ name: "history", kind: "nested", emitted: true, chill: true }, store, activity).row);
	for (const row of rows) row.render(100);
	let expanded = false;
	const toggleMs = measure(() => {
		expanded = !expanded;
		for (const row of rows) { row.setExpanded(expanded); row.render(100); }
	}, 3);
	return { rows: count, toggleMs, usPerRow: toggleMs * 1000 / count };
});

const manyImages = [1, 16, 64, 256].map((count) => {
	const content = Array.from({ length: count }, () => image);
	const cache: RenderedImage[] = [];
	renderTextAndImages("", content, theme, cache).render(100);
	const first = ids(renderTextAndImages("", content, theme, cache).render(100));
	const next = ids(renderTextAndImages("", content, theme, cache).render(100));
	if (first.length !== count || JSON.stringify(first) !== JSON.stringify(next)) failures.push(`Repeated image placements/cache mismatch at ${count} images`);
	return { images: count, rebuildMs: measure(() => { renderTextAndImages("", content, theme, cache); }) };
});

// Captures exceed the default shared budget. Visible images must still belong to their rows.
const largeImage = { ...image, data: imageFixture(768, true) };
const largeResult = { content: [text, largeImage], details: {} };
const captureStore = new CodeModeNestedRenderStore();
const imageRows = Array.from({ length: 20 }, () => makeRow({ name: "image-history", kind: "nested" }, captureStore, undefined, largeResult).row);
const initialIds = imageRows.map((row) => ids(row.render(100)));
for (const row of imageRows) row.setExpanded(true);
const expandedIds = imageRows.map((row) => ids(row.render(100)));
const reusedImages = initialIds.filter((before, index) => before.length === 1 && JSON.stringify(before) === JSON.stringify(expandedIds[index])).length;
if (reusedImages !== imageRows.length) failures.push(`Capture eviction discarded visible images: ${reusedImages}/${imageRows.length} reused`);
let expanded = true;
const heavyToggleMs = measure(() => {
	expanded = !expanded;
	for (const row of imageRows) { row.setExpanded(expanded); row.render(100); }
}, 3);
const imageHeavyHistory = { rows: imageRows.length, sourceBase64Bytes: largeImage.data.length, totalCaptureBytes: largeImage.data.length * imageRows.length, reusedImages, toggleMs: heavyToggleMs };

console.log(JSON.stringify({ runtime: process.version, protocol: "kitty", fixtureBase64Bytes: image.data.length, cases, history, chillHistory, manyImages, imageHeavyHistory, failures }, null, 2));
if (verify && failures.length) process.exitCode = 1;
