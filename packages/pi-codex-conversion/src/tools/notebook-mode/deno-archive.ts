import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";
import type { DenoAsset } from "./deno-assets.ts";

const inflate = promisify(inflateRaw);

// Only the single-entry, deflated ZIP layout of the checksum-pinned Deno assets.
// The caller verifies archive and executable SHA-256; this is not a general ZIP reader.
export async function extractDenoArchive(
	archive: Buffer,
	asset: DenoAsset,
): Promise<Buffer> {
	const invalid = () =>
		new Error(`unsupported pinned Deno archive layout: ${asset.archive}`);
	const end = archive.length - 22;
	if (end < 30 || archive.readUInt32LE(end) !== 0x06054b50) throw invalid();
	if (
		archive.readUInt16LE(end + 4) !== 0 ||
		archive.readUInt16LE(end + 6) !== 0 ||
		archive.readUInt16LE(end + 8) !== 1 ||
		archive.readUInt16LE(end + 10) !== 1 ||
		archive.readUInt16LE(end + 20) !== 0
	)
		throw invalid();
	const directoryBytes = archive.readUInt32LE(end + 12);
	const directory = archive.readUInt32LE(end + 16);
	if (
		directory < 30 ||
		directory + directoryBytes !== end ||
		directoryBytes < 46
	)
		throw invalid();
	if (
		archive.readUInt32LE(directory) !== 0x02014b50 ||
		archive.readUInt32LE(0) !== 0x04034b50
	)
		throw invalid();
	const nameBytes = archive.readUInt16LE(26);
	const dataStart = 30 + nameBytes + archive.readUInt16LE(28);
	const compressedBytes = archive.readUInt32LE(18);
	const centralNameBytes = archive.readUInt16LE(directory + 28);
	if (
		archive.readUInt16LE(6) !== 0 ||
		archive.readUInt16LE(8) !== 8 ||
		archive.readUInt32LE(22) !== asset.binaryBytes ||
		dataStart + compressedBytes !== directory ||
		archive.readUInt16LE(directory + 8) !== 0 ||
		archive.readUInt16LE(directory + 10) !== 8 ||
		archive.readUInt32LE(directory + 16) !== archive.readUInt32LE(14) ||
		archive.readUInt32LE(directory + 20) !== compressedBytes ||
		archive.readUInt32LE(directory + 24) !== asset.binaryBytes ||
		archive.readUInt16LE(directory + 34) !== 0 ||
		archive.readUInt32LE(directory + 42) !== 0 ||
		46 +
			centralNameBytes +
			archive.readUInt16LE(directory + 30) +
			archive.readUInt16LE(directory + 32) !==
			directoryBytes ||
		archive.subarray(30, 30 + nameBytes).toString("utf8") !==
			asset.executable ||
		archive
			.subarray(directory + 46, directory + 46 + centralNameBytes)
			.toString("utf8") !== asset.executable
	)
		throw invalid();
	return inflate(archive.subarray(dataStart, directory), {
		maxOutputLength: asset.binaryBytes,
	});
}
