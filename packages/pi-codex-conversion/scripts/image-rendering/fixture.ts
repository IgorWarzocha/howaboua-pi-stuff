import { deflateSync } from "node:zlib";

/** A valid, deterministic PNG; no captured user image or network dependency. */
export function imageFixture(size = 128, noise = false): string {
	function chunk(type: string, data: Buffer): Buffer {
		const body = Buffer.concat([Buffer.from(type), data]);
		let crc = 0xffffffff;
		for (const byte of body) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
		const result = Buffer.alloc(body.length + 8);
		result.writeUInt32BE(data.length);
		body.copy(result, 4);
		result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
		return result;
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size);
	header.writeUInt32BE(size, 4);
	header[8] = 8;
	header[9] = 2;
	const pixels = Buffer.alloc(size * (size * 3 + 1));
	let seed = 42;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size * 3; x++) {
			seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
			pixels[y * (size * 3 + 1) + x + 1] = noise ? seed & 255 : (x * 17 + y * 31) & 255;
		}
	}
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
	]).toString("base64");
}
