type ContentImage = { image_url: string; detail: "auto" | "low" | "high" | "original" };

// Literal source keeps all four runtimes independent of host transpiler helpers.
export const contentOutputFactorySource = String.raw`(text, image) => {
	const record = value => typeof value === "object" && value !== null && !Array.isArray(value);
	const invalid = () => { throw new TypeError("content expects an MCP content block or iterable of blocks"); };
	const emit = block => {
		if (!record(block)) return invalid();
		switch (block["type"]) {
			case "text": {
				if (typeof block["text"] !== "string") return invalid();
				if (record(block["_meta"]) && block["_meta"]["codex/encryptedContent"] === true) throw new TypeError("Encrypted text cannot be displayed; request plain text instead");
				text(block["text"]);
				return;
			}
			case "image": {
				const data = block["data"];
				if (typeof data !== "string") return invalid();
				const mime = block["mimeType"] ?? block["mime_type"] ?? "application/octet-stream";
				if (typeof mime !== "string") return invalid();
				const url = /^data:/i.test(data) ? data : "data:" + mime + ";base64," + data;
				if (!/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(url)) throw new TypeError("content image expects base64 data; remote image URLs are unavailable");
				const detail = record(block["_meta"]) ? block["_meta"]["codex/imageDetail"] : undefined;
				image({ image_url: url, detail: detail === "auto" || detail === "low" || detail === "original" ? detail : "high" });
				return;
			}
			case "audio": throw new TypeError("content cannot emit audio in Pi; return text or images instead");
			case "resource":
			case "resource_link": {
				const encoded = JSON.stringify(block);
				if (encoded === undefined) return invalid();
				text(encoded);
				return;
			}
			default: return invalid();
		}
	};
	return function content(value) {
		const iterate = value !== null && value !== undefined && typeof value !== "string" ? Object(value)[Symbol.iterator] : undefined;
		if (typeof iterate !== "function") return emit(value);
		const blocks = { [Symbol.iterator]: () => Reflect.apply(iterate, value, []) };
		for (const block of blocks) emit(block);
	};
}`;

export const createContentOutput = new Function("return (" + contentOutputFactorySource + ")")() as
	(text: (value: unknown) => unknown, image: (value: ContentImage) => unknown) => (value: unknown) => void;

export function withContentOutput(source: string): string {
	return "(() => { globalThis.content = (" + contentOutputFactorySource.replaceAll("\n", "") + ")(globalThis.text, globalThis.image); })();" + source;
}
