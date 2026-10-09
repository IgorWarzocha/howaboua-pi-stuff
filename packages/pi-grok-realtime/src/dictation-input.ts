// STT uses Grok Build's 16 kHz wire format; Pi's local/LAN audio stays 24 kHz.
export class DictationPcm {
	private pending: number[] = [];
	convert(pcm: Buffer): Buffer {
		const samples = this.pending;
		for (let offset = 0; offset < pcm.length; offset += 2)
			samples.push(pcm.readInt16LE(offset));
		const groups = Math.floor(samples.length / 3);
		const output = Buffer.allocUnsafe(groups * 4);
		for (let group = 0; group < groups; group++) {
			const [a, b, c] = samples.slice(group * 3, group * 3 + 3) as [
				number,
				number,
				number,
			];
			// Area-average each 1.5-sample interval, carrying incomplete groups.
			output.writeInt16LE(Math.round((2 * a + b) / 3), group * 4);
			output.writeInt16LE(Math.round((b + 2 * c) / 3), group * 4 + 2);
		}
		this.pending = samples.slice(groups * 3);
		return output;
	}
}

const LANGUAGES = new Set(
	"ar cs da nl en fil fr de hi id it ja ko mk ms fa pl pt ro ru es sv th tr vi".split(
		" ",
	),
);

/** STT needs a concrete normalization language, unlike realtime's auto setting. */
export function dictationLanguage(language: string, env = process.env): string {
	let value = language.trim().toLowerCase();
	if (value === "auto")
		value = (
			env["LC_ALL"] ||
			env["LC_MESSAGES"] ||
			env["LANG"] ||
			"en"
		).toLowerCase();
	const primary = value.split(/[_\-.]/)[0]!.trim();
	return primary === "tl" ? "fil" : LANGUAGES.has(primary) ? primary : "en";
}
