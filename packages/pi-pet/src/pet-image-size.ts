import { readFile } from "node:fs/promises";

export interface ImageSize {
  format: "png" | "webp";
  width: number;
  height: number;
}

function extendedWebpSize(buffer: Buffer, data: number, size: number): ImageSize | undefined {
  if (size < 10) return undefined;
  return { format: "webp", width: 1 + buffer.readUIntLE(data + 4, 3), height: 1 + buffer.readUIntLE(data + 7, 3) };
}

function lossyWebpSize(buffer: Buffer, data: number, size: number): ImageSize | undefined {
  if (size < 10 || buffer[data + 3] !== 0x9d || buffer[data + 4] !== 0x01 || buffer[data + 5] !== 0x2a)
    return undefined;
  return {
    format: "webp",
    width: buffer.readUInt16LE(data + 6) & 0x3fff,
    height: buffer.readUInt16LE(data + 8) & 0x3fff,
  };
}

function losslessWebpSize(buffer: Buffer, data: number, size: number): ImageSize | undefined {
  if (size < 5 || buffer[data] !== 0x2f) return undefined;
  const b1 = buffer[data + 1] ?? 0;
  const b2 = buffer[data + 2] ?? 0;
  const b3 = buffer[data + 3] ?? 0;
  const b4 = buffer[data + 4] ?? 0;
  return {
    format: "webp",
    width: 1 + ((b1 | (b2 << 8)) & 0x3fff),
    height: 1 + (((b2 >> 6) | (b3 << 2) | (b4 << 10)) & 0x3fff),
  };
}

function webpChunkSize(buffer: Buffer, type: string, data: number, size: number): ImageSize | undefined {
  if (type === "VP8X") return extendedWebpSize(buffer, data, size);
  if (type === "VP8 ") return lossyWebpSize(buffer, data, size);
  if (type === "VP8L") return losslessWebpSize(buffer, data, size);
  return undefined;
}

function webpSize(buffer: Buffer): ImageSize | undefined {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP")
    return undefined;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > buffer.length) throw new Error("Truncated WebP chunk.");
    const dimensions = webpChunkSize(buffer, type, data, size);
    if (dimensions) return dimensions;
    offset = data + size + (size % 2);
  }
  throw new Error("WebP dimensions were not found.");
}

export function imageSize(buffer: Buffer): ImageSize {
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.length >= 24 && buffer.subarray(0, 8).toString("hex") === pngSignature) {
    return { format: "png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  const webp = webpSize(buffer);
  if (webp) return webp;
  throw new Error("Asset must be a PNG or WebP image.");
}

export async function readImageSize(path: string): Promise<ImageSize> {
  return imageSize(await readFile(path));
}
