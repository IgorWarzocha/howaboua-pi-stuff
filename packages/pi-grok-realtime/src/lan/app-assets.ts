import { readFileSync } from "node:fs";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { resolveLanVoiceWebTheme } from "./theme.js";

const assets: Record<string, [string, string]> = {
	"/favicon.svg": ["grok.svg", "image/svg+xml"],
	"/icon-192.png": ["icon-192.png", "image/png"],
	"/icon-512.png": ["icon-512.png", "image/png"],
	"/apple-touch-icon.png": ["apple-touch-icon.png", "image/png"],
};
export function appAsset(
	path: string,
): { contentType: string; body: Buffer } | undefined {
	const asset = Object.hasOwn(assets, path) ? assets[path] : undefined;
	if (!asset) return;
	return {
		contentType: asset[1],
		body: readFileSync(new URL(`./assets/${asset[0]}`, import.meta.url)),
	};
}
export function manifest(theme: Theme): string {
	const { pageColor } = resolveLanVoiceWebTheme(theme);
	return JSON.stringify({
		id: "/",
		name: "Grok remote control",
		short_name: "Grok",
		description: "Voice and message remote control for the active Pi session",
		start_url: "/",
		scope: "/",
		display: "standalone",
		background_color: pageColor,
		theme_color: pageColor,
		icons: [
			{
				src: "/icon-192.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/icon-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any maskable",
			},
		],
	});
}
