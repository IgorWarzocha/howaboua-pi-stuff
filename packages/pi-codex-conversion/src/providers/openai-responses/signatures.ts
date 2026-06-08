export type TextSignaturePhase = "commentary" | "final_answer";

export function shortHash(str: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

export function encodeTextSignatureV1(id: string, phase?: string): string {
	const payload: { v: 1; id: string; phase?: string | undefined } = { v: 1, id };
	if (phase) payload.phase = phase;
	return JSON.stringify(payload);
}

export function parseTextSignature(signature: string | undefined): { id: string; phase?: TextSignaturePhase | undefined } | undefined {
	if (!signature) return undefined;
	if (signature.startsWith("{")) {
		try {
			const parsed = JSON.parse(signature) as { v?: number | undefined; id?: string | undefined; phase?: TextSignaturePhase | string | undefined };
			if (parsed.v === 1 && typeof parsed.id === "string") {
				return parsed.phase === "commentary" || parsed.phase === "final_answer" ? { id: parsed.id, phase: parsed.phase } : { id: parsed.id };
			}
		} catch {
			// Fall through to legacy plain-string handling.
		}
	}
	return { id: signature };
}

