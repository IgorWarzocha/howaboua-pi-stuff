const PNG_SIGNATURE = Uint8Array.of(
	0x89,
	0x50,
	0x4e,
	0x47,
	0x0d,
	0x0a,
	0x1a,
	0x0a,
);

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
	return prefix.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
	return Buffer.from(bytes.subarray(start, end)).toString("ascii");
}

function u16be(bytes: Uint8Array, offset: number): number {
	return bytes[offset]! * 0x100 + bytes[offset + 1]!;
}

function u16le(bytes: Uint8Array, offset: number): number {
	return bytes[offset]! + bytes[offset + 1]! * 0x100;
}

function u32be(bytes: Uint8Array, offset: number): number {
	return (
		(bytes[offset]! * 0x1_000000 +
			bytes[offset + 1]! * 0x1_0000 +
			bytes[offset + 2]! * 0x100 +
			bytes[offset + 3]!) >>>
		0
	);
}

function u32le(bytes: Uint8Array, offset: number): number {
	return (
		(bytes[offset]! +
			bytes[offset + 1]! * 0x100 +
			bytes[offset + 2]! * 0x1_0000 +
			bytes[offset + 3]! * 0x1_000000) >>>
		0
	);
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
	let crc = 0xffff_ffff;
	for (let index = start; index < end; index++) {
		crc ^= bytes[index]!;
		for (let bit = 0; bit < 8; bit++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
		}
	}
	return (crc ^ 0xffff_ffff) >>> 0;
}

function validPng(bytes: Uint8Array): boolean {
	if (bytes.length < 45 || !startsWith(bytes, PNG_SIGNATURE)) return false;
	let offset = PNG_SIGNATURE.length;
	let first = true;
	let sawHeader = false;
	let sawImageData = false;
	while (offset + 12 <= bytes.length) {
		const length = u32be(bytes, offset);
		const typeStart = offset + 4;
		const dataStart = typeStart + 4;
		const dataEnd = dataStart + length;
		const chunkEnd = dataEnd + 4;
		if (dataEnd < dataStart || chunkEnd > bytes.length) return false;
		if (crc32(bytes, typeStart, dataEnd) !== u32be(bytes, dataEnd))
			return false;
		const type = ascii(bytes, typeStart, dataStart);
		if (first) {
			if (
				type !== "IHDR" ||
				length !== 13 ||
				u32be(bytes, dataStart) === 0 ||
				u32be(bytes, dataStart + 4) === 0
			)
				return false;
			sawHeader = true;
			first = false;
		} else if (type === "IHDR") {
			return false;
		}
		if (type === "IDAT") sawImageData = true;
		if (type === "IEND") {
			return (
				length === 0 && sawHeader && sawImageData && chunkEnd === bytes.length
			);
		}
		offset = chunkEnd;
	}
	return false;
}

function jpegFrameMarker(marker: number): boolean {
	return (
		(marker >= 0xc0 && marker <= 0xc3) ||
		(marker >= 0xc5 && marker <= 0xc7) ||
		(marker >= 0xc9 && marker <= 0xcb) ||
		(marker >= 0xcd && marker <= 0xcf)
	);
}

function validJpeg(bytes: Uint8Array): boolean {
	if (
		bytes.length < 12 ||
		bytes[0] !== 0xff ||
		bytes[1] !== 0xd8 ||
		bytes.at(-2) !== 0xff ||
		bytes.at(-1) !== 0xd9
	)
		return false;
	let offset = 2;
	let sawFrame = false;
	let sawScan = false;
	while (offset < bytes.length) {
		if (bytes[offset] !== 0xff) return false;
		while (bytes[offset] === 0xff) offset++;
		const marker = bytes[offset++];
		if (marker === undefined || marker === 0x00) return false;
		if (marker === 0xd9) return sawFrame && sawScan && offset === bytes.length;
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
		if (offset + 2 > bytes.length) return false;
		const length = u16be(bytes, offset);
		if (length < 2 || offset + length > bytes.length) return false;
		if (jpegFrameMarker(marker)) {
			if (
				length < 7 ||
				u16be(bytes, offset + 3) === 0 ||
				u16be(bytes, offset + 5) === 0
			)
				return false;
			sawFrame = true;
		}
		offset += length;
		if (marker !== 0xda) continue;
		sawScan = true;
		while (offset < bytes.length) {
			if (bytes[offset] !== 0xff) {
				offset++;
				continue;
			}
			const markerStart = offset;
			while (bytes[offset] === 0xff) offset++;
			const entropyMarker = bytes[offset];
			if (
				entropyMarker === 0x00 ||
				(entropyMarker! >= 0xd0 && entropyMarker! <= 0xd7)
			) {
				offset++;
				continue;
			}
			offset = markerStart;
			break;
		}
	}
	return false;
}

function skipGifSubBlocks(
	bytes: Uint8Array,
	start: number,
): number | undefined {
	let offset = start;
	while (offset < bytes.length) {
		const length = bytes[offset++]!;
		if (length === 0) return offset;
		if (offset + length > bytes.length) return undefined;
		offset += length;
	}
	return undefined;
}

function validGif(bytes: Uint8Array): boolean {
	if (
		bytes.length < 14 ||
		!["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6)) ||
		u16le(bytes, 6) === 0 ||
		u16le(bytes, 8) === 0
	)
		return false;
	let offset = 13;
	const globalTable = (bytes[10]! & 0x80) !== 0;
	if (globalTable) offset += 3 * 2 ** ((bytes[10]! & 0x07) + 1);
	if (offset > bytes.length) return false;
	let sawImage = false;
	while (offset < bytes.length) {
		const introducer = bytes[offset++]!;
		if (introducer === 0x3b) return sawImage && offset === bytes.length;
		if (introducer === 0x21) {
			if (offset >= bytes.length) return false;
			offset++;
			const next = skipGifSubBlocks(bytes, offset);
			if (next === undefined) return false;
			offset = next;
			continue;
		}
		if (introducer !== 0x2c || offset + 9 > bytes.length) return false;
		const width = u16le(bytes, offset + 4);
		const height = u16le(bytes, offset + 6);
		if (width === 0 || height === 0) return false;
		const packed = bytes[offset + 8]!;
		offset += 9;
		if ((packed & 0x80) !== 0) offset += 3 * 2 ** ((packed & 0x07) + 1);
		if (offset >= bytes.length) return false;
		offset++;
		const next = skipGifSubBlocks(bytes, offset);
		if (next === undefined) return false;
		offset = next;
		sawImage = true;
	}
	return false;
}

function validWebp(bytes: Uint8Array): boolean {
	if (
		bytes.length < 20 ||
		ascii(bytes, 0, 4) !== "RIFF" ||
		ascii(bytes, 8, 12) !== "WEBP" ||
		u32le(bytes, 4) + 8 !== bytes.length
	)
		return false;
	let offset = 12;
	let sawImage = false;
	while (offset + 8 <= bytes.length) {
		const type = ascii(bytes, offset, offset + 4);
		const length = u32le(bytes, offset + 4);
		const data = offset + 8;
		const end = data + length;
		const paddedEnd = end + (length & 1);
		if (end < data || paddedEnd > bytes.length) return false;
		if (type === "VP8 ") {
			if (
				length < 10 ||
				bytes[data + 3] !== 0x9d ||
				bytes[data + 4] !== 0x01 ||
				bytes[data + 5] !== 0x2a ||
				(u16le(bytes, data + 6) & 0x3fff) === 0 ||
				(u16le(bytes, data + 8) & 0x3fff) === 0
			)
				return false;
			sawImage = true;
		} else if (type === "VP8L") {
			if (length < 5 || bytes[data] !== 0x2f) return false;
			sawImage = true;
		} else if (type === "ANMF") {
			if (length < 16) return false;
			sawImage = true;
		}
		offset = paddedEnd;
	}
	return sawImage && offset === bytes.length;
}

export function validatedImageMime(bytes: Uint8Array): string | undefined {
	if (validPng(bytes)) return "image/png";
	if (validJpeg(bytes)) return "image/jpeg";
	if (validGif(bytes)) return "image/gif";
	if (validWebp(bytes)) return "image/webp";
	return undefined;
}
