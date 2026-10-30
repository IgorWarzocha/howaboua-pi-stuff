import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";

const MAX_REQUEST_BYTES = 300 * 1024;

export function boundedString(
	value: unknown,
	maxBytes: number,
): string | undefined {
	return typeof value === "string" &&
		value.length > 0 &&
		Buffer.byteLength(value) <= maxBytes
		? value
		: undefined;
}

export function isLanVoiceOriginAllowed(request: IncomingMessage): boolean {
	const { origin, host } = request.headers;
	// Browsers send Origin; non-browser clients retain trusted-LAN access.
	return (
		origin === undefined || (host !== undefined && origin === `https://${host}`)
	);
}

export class LanVoiceRequestError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export async function readJson(
	request: IncomingMessage,
): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += buffer.byteLength;
		if (bytes > MAX_REQUEST_BYTES)
			throw new LanVoiceRequestError(413, "LAN voice request is too large");
		chunks.push(buffer);
	}
	try {
		const value = JSON.parse(
			Buffer.concat(chunks).toString("utf8") || "{}",
		) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error();
		return value as Record<string, unknown>;
	} catch {
		throw new LanVoiceRequestError(
			400,
			"LAN voice request must be a JSON object",
		);
	}
}

export function requiredClientId(body: Record<string, unknown>): string {
	const clientId = boundedString(body["clientId"], 128);
	if (!clientId)
		throw new LanVoiceRequestError(400, "A browser client ID is required");
	return clientId;
}

export function sendText(
	response: ServerResponse,
	contentType: string,
	body: string,
	html = false,
): void {
	response.writeHead(200, {
		"cache-control": "no-store",
		"content-type": contentType,
		"x-content-type-options": "nosniff",
		...(html
			? {
					"content-security-policy":
						"default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'unsafe-inline'; connect-src 'self' wss:; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
					"permissions-policy": "microphone=(self), camera=()",
				}
			: {}),
	});
	response.end(body);
}

export function sendJson(
	response: ServerResponse,
	status: number,
	value: unknown,
): void {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
		"x-content-type-options": "nosniff",
	});
	response.end(JSON.stringify(value));
}

export function sendBinary(
	response: ServerResponse,
	contentType: string,
	body: Buffer,
	cache = true,
): void {
	response.writeHead(200, {
		"cache-control": cache ? "public, max-age=86400" : "no-store",
		"content-length": body.byteLength,
		"content-type": contentType,
		"x-content-type-options": "nosniff",
	});
	response.end(body);
}

export async function sendFile(
	response: ServerResponse,
	asset: { contentType: string; path: string },
	cache: boolean,
): Promise<void> {
	response.writeHead(200, {
		"cache-control": cache ? "public, max-age=86400" : "no-store",
		"content-type": asset.contentType,
		"x-content-type-options": "nosniff",
		"content-security-policy": "frame-ancestors 'self'",
	});
	await pipeline(createReadStream(asset.path), response);
}

export function assertJsonPost(request: IncomingMessage): void {
	const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim();
	if (contentType !== "application/json")
		throw new LanVoiceRequestError(
			415,
			"GipPity requests must use application/json",
		);
	if (!isLanVoiceOriginAllowed(request))
		throw new LanVoiceRequestError(
			403,
			"Cross-origin GipPity requests are not allowed",
		);
}
