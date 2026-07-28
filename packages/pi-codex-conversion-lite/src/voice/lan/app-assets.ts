import { readFileSync } from "node:fs";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { resolveLanVoiceWebTheme } from "./theme.ts";

export interface LanVoiceAppAsset {
	contentType: string;
	body: Buffer;
}

const ASSETS = {
	"/apple-touch-icon.png": ["apple-touch-icon.png", "image/png"],
	"/favicon.svg": ["gippity-icon.svg", "image/svg+xml"],
	"/icon-192.png": ["gippity-icon-192.png", "image/png"],
	"/icon-512.png": ["gippity-icon-512.png", "image/png"],
} as const;

const cache = new Map<keyof typeof ASSETS, Buffer>();

export function getLanVoiceAppAsset(path: string): LanVoiceAppAsset | undefined {
	if (!(path in ASSETS)) return undefined;
	const assetPath = path as keyof typeof ASSETS;
	const [filename, contentType] = ASSETS[assetPath];
	let body = cache.get(assetPath);
	if (!body) {
		body = readFileSync(new URL(`../../../src/voice/lan/assets/${filename}`, import.meta.url));
		cache.set(assetPath, body);
	}
	return { body, contentType };
}

export function createLanVoiceWebManifest(piTheme: Theme): string {
	const theme = resolveLanVoiceWebTheme(piTheme);
	return JSON.stringify({
		id: "/",
		name: "GipPity remote control",
		short_name: "GipPity",
		description: "Voice and message remote control for the active Pi session",
		start_url: "/",
		scope: "/",
		display: "standalone",
		background_color: theme.pageColor,
		theme_color: theme.pageColor,
		icons: [
			{ src: "/icon-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
			{ src: "/icon-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any maskable" },
		],
	});
}
