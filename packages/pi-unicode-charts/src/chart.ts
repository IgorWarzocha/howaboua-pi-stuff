export const CHART_TYPES = [
	"bar",
	"line",
	"scatter",
	"sparkline",
	"heatmap",
] as const;

export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartPoint {
	label: string;
	value: number;
}

export interface HeatmapRow {
	label: string;
	values: number[];
}

export interface ChartSpec {
	type: ChartType;
	title?: string;
	points: ChartPoint[];
	rows?: HeatmapRow[];
}

const MINIMUM_WIDTH = 24;
const MAX_POINTS = 64;
const MAX_HEATMAP_ROWS = 32;
const MAX_SOURCE_LENGTH = 12_000;
const PLOT_ROWS = 8;
const BRAILLE_DOTS = [
	[0, 0, 1],
	[0, 1, 2],
	[0, 2, 4],
	[1, 0, 8],
	[1, 1, 16],
	[1, 2, 32],
	[0, 3, 64],
	[1, 3, 128],
] as const;
const BRAILLE_BAR_ROWS = [9, 18, 36, 192] as const;
const SPARK_GLYPHS = "▁▂▃▄▅▆▇█";
const HEAT_GLYPHS = "░▒▓█";

interface Fence {
	character: "`" | "~";
	length: number;
}

export function transformChartMarkdown(
	markdown: string,
	availableWidth: number,
): string {
	const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
	const lines = markdown.split(/\r?\n/u);
	const output: string[] = [];

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const opening = parseOpeningFence(line);
		if (!opening) {
			output.push(line);
			continue;
		}

		const close = findClosingFence(lines, index + 1, opening.fence);
		if (close === undefined) {
			output.push(...lines.slice(index));
			break;
		}
		if (opening.language !== "chart") {
			output.push(...lines.slice(index, close + 1));
			index = close;
			continue;
		}

		const source = lines.slice(index + 1, close).join("\n");
		const spec = parseChartSource(source);
		const rendered = spec ? renderChart(spec, availableWidth) : [];
		if (rendered.length === 0) {
			output.push(...lines.slice(index, close + 1));
		} else {
			output.push(
				...rendered.map((renderedLine) => `${codeSpan(renderedLine)}  `),
			);
		}
		index = close;
	}

	return output.join(newline);
}

export function parseChartSource(source: string): ChartSpec | undefined {
	if (source.length > MAX_SOURCE_LENGTH) return undefined;
	const sourceLines = source.split(/\r?\n/u);
	let type: ChartType | undefined;
	let title: string | undefined;
	const dataLines: string[] = [];

	for (const sourceLine of sourceLines) {
		const line = sourceLine.trim();
		if (!line || line.startsWith("#")) continue;

		const typeMatch = /^type\s*:\s*([a-z]+)\s*$/iu.exec(line);
		if (typeMatch) {
			const parsedType = normalizeChartType(typeMatch[1]);
			if (!parsedType) return undefined;
			type = parsedType;
			continue;
		}
		if (
			/^(?:bar|histogram|line|scatter|sparkline|heatmap)$/iu.test(line) &&
			!type
		) {
			type = normalizeChartType(line);
			continue;
		}

		const titleMatch = /^title\s*:\s*(.*?)\s*$/iu.exec(line);
		if (titleMatch) {
			title = titleMatch[1]?.trim() || undefined;
			continue;
		}
		if (/^data\s*:\s*$/iu.test(line)) {
			continue;
		}
		if (
			/^(?:width|height|x[-_ ]?min|x[-_ ]?max|y[-_ ]?min|y[-_ ]?max)\s*:/iu.test(
				line,
			)
		) {
			continue;
		}
		dataLines.push(sourceLine);
	}

	if (!type) type = "bar";
	if (type === "heatmap") {
		const rows = dataLines
			.map(parseHeatmapRow)
			.filter((row): row is HeatmapRow => row !== undefined);
		return rows.length > 0
			? {
					type,
					...(title ? { title } : {}),
					points: [],
					rows: rows.slice(0, MAX_HEATMAP_ROWS),
				}
			: undefined;
	}

	if (type === "sparkline") {
		const values = dataLines.flatMap((dataLine, lineIndex) => {
			const fields = dataLine
				.trim()
				.split(/[\s,|\t]+/u)
				.filter(Boolean);
			const numericFields = fields.map(parseNumber);
			if (
				numericFields.every((value): value is number => value !== undefined)
			) {
				return numericFields.map((value, valueIndex) => ({
					label: String(lineIndex + valueIndex + 1),
					value,
				}));
			}
			const point = parsePoint(dataLine, lineIndex);
			return point ? [point] : [];
		});
		return values.length > 0
			? {
					type,
					...(title ? { title } : {}),
					points: values.slice(0, MAX_POINTS),
				}
			: undefined;
	}

	const points = dataLines
		.map(parsePoint)
		.filter((point): point is ChartPoint => point !== undefined);
	return points.length > 0
		? { type, ...(title ? { title } : {}), points: points.slice(0, MAX_POINTS) }
		: undefined;
}

export function renderChart(spec: ChartSpec, availableWidth: number): string[] {
	if (!Number.isFinite(availableWidth) || availableWidth < MINIMUM_WIDTH)
		return [];
	if (spec.type !== "heatmap" && spec.points.length === 0) return [];

	const width = Math.floor(availableWidth);
	const body =
		spec.type === "bar"
			? renderBars(spec.points, width)
			: spec.type === "sparkline"
				? renderSparkline(spec.points, width)
				: spec.type === "heatmap"
					? renderHeatmap(spec.rows ?? [], width)
					: renderBraille(spec.points, spec.type === "line", width);
	if (body.length === 0) return [];

	const lines = spec.title ? [spec.title, ...body] : body;
	return lines.map((line) => truncate(line, width));
}

function normalizeChartType(value: string | undefined): ChartType | undefined {
	const normalized = value?.trim().toLowerCase();
	return normalized === "histogram"
		? "bar"
		: CHART_TYPES.find((type) => type === normalized);
}

function parseOpeningFence(
	line: string,
): { fence: Fence; language: string } | undefined {
	const match = /^(?: {0,3})(`{3,}|~{3,})[^\S\r\n]*(.*)$/u.exec(line);
	if (!match?.[1]) return undefined;
	const fenceCharacter = match[1][0];
	if (fenceCharacter !== "`" && fenceCharacter !== "~") return undefined;
	const info = (match[2] ?? "").trim();
	if (fenceCharacter === "`" && info.includes("`")) return undefined;
	return {
		fence: { character: fenceCharacter, length: match[1].length },
		language: info.split(/\s+/u, 1)[0]?.toLowerCase() ?? "",
	};
}

function findClosingFence(
	lines: string[],
	start: number,
	fence: Fence,
): number | undefined {
	for (let index = start; index < lines.length; index += 1) {
		const trimmed = (lines[index] ?? "").replace(/^ {0,3}/u, "").trimEnd();
		if (
			trimmed.length < fence.length ||
			trimmed.split("").some((character) => character !== fence.character)
		) {
			continue;
		}
		return index;
	}
	return undefined;
}

function parsePoint(sourceLine: string, index: number): ChartPoint | undefined {
	const line = sourceLine.trim();
	if (!line || /^[-|]+$/u.test(line)) return undefined;

	const delimited = line.split(/\s*[|,\t]\s*/u).filter(Boolean);
	if (delimited.length >= 2) {
		const value = parseNumber(delimited[delimited.length - 1]);
		const label = delimited.slice(0, -1).join(" ").trim();
		if (value !== undefined && label) return { label, value };
	}

	const pair = /^(.*?)\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?)$/iu.exec(
		line,
	);
	if (pair?.[1] && pair[2]) {
		const value = parseNumber(pair[2]);
		if (value !== undefined) return { label: pair[1].trim(), value };
	}

	const value = parseNumber(line);
	return value === undefined ? undefined : { label: String(index + 1), value };
}

function parseHeatmapRow(sourceLine: string): HeatmapRow | undefined {
	const line = sourceLine.trim();
	if (!line || /^[-|]+$/u.test(line)) return undefined;
	const fields = line.split(/\s*[|,\t]\s*/u).filter(Boolean);
	const cells = fields.length >= 2 ? fields : line.split(/\s+/u);
	if (cells.length < 2) return undefined;
	const label = cells[0]?.trim();
	if (!label) return undefined;
	const values = cells.slice(1).map(parseNumber);
	return values.every((value): value is number => value !== undefined)
		? { label, values }
		: undefined;
}

function parseNumber(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const number = Number(value.trim().replace(/%$/u, ""));
	return Number.isFinite(number) ? number : undefined;
}

function renderBars(points: ChartPoint[], width: number): string[] {
	const values = points.map((point) => point.value);
	const minimum = Math.min(0, ...values);
	let maximum = Math.max(0, ...values);
	const zeroOnly = minimum === maximum;
	if (zeroOnly) maximum = 1;
	const range = maximum - minimum;
	const zeroRow = Math.min(
		PLOT_ROWS - 1,
		Math.floor((PLOT_ROWS * maximum) / range),
	);
	const tickRows = new Set(zeroOnly ? [zeroRow] : [0, PLOT_ROWS - 1, zeroRow]);
	if (!zeroOnly && (zeroRow === 0 || zeroRow === PLOT_ROWS - 1)) {
		tickRows.add(Math.floor(PLOT_ROWS / 2));
	}
	const tickLabels = Array.from({ length: PLOT_ROWS }, (_, row) =>
		tickRows.has(row)
			? formatNumber(barAxisValue(row, minimum, maximum, zeroRow))
			: "",
	);
	const yLabelWidth = Math.max(
		3,
		...tickLabels.map((label) => displayWidth(label)),
	);
	const plotWidth = width - yLabelWidth - 3;
	if (plotWidth < points.length) return [];

	const gap = points.length * 2 - 1 <= plotWidth ? 1 : 0;
	const barWidth = Math.max(
		1,
		Math.floor((plotWidth - gap * (points.length - 1)) / points.length),
	);
	const usedWidth = points.length * barWidth + gap * (points.length - 1);
	const lines: string[] = [];

	for (let row = 0; row < PLOT_ROWS; row += 1) {
		const label = tickLabels[row] ?? "";
		const bars = values
			.map((value) => barCell(value, row, barWidth, minimum, maximum))
			.join(" ".slice(0, gap));
		lines.push(
			`${label.padStart(yLabelWidth)} ${row === zeroRow ? "┼" : "┤"}${bars}`,
		);
	}

	lines.push(`${"".padStart(yLabelWidth)} └${"─".repeat(usedWidth)}`);
	const labels = points
		.map((point) =>
			center(truncate(point.label, barWidth), barWidth).padEnd(barWidth + gap),
		)
		.join("");
	lines.push(`${"".padStart(yLabelWidth + 2)}${labels.trimEnd()}`);
	return lines;
}

function barCell(
	value: number,
	row: number,
	width: number,
	minimum: number,
	maximum: number,
): string {
	if (value === 0) return " ".repeat(width);
	const range = maximum - minimum;
	const subrows = PLOT_ROWS * BRAILLE_BAR_ROWS.length;
	const zeroPosition = (maximum / range) * subrows;
	const valuePosition = ((maximum - value) / range) * subrows;
	const start = Math.min(zeroPosition, valuePosition);
	const end = Math.max(zeroPosition, valuePosition);
	let bits = 0;

	for (let subrow = 0; subrow < BRAILLE_BAR_ROWS.length; subrow += 1) {
		const center = row * BRAILLE_BAR_ROWS.length + subrow + 0.5;
		if (center >= start && center < end) bits |= BRAILLE_BAR_ROWS[subrow] ?? 0;
	}
	if (bits === 0) {
		const marker = Math.max(
			0,
			Math.min(subrows - 1, Math.floor((start + end) / 2)),
		);
		if (Math.floor(marker / BRAILLE_BAR_ROWS.length) === row) {
			bits = BRAILLE_BAR_ROWS[marker % BRAILLE_BAR_ROWS.length] ?? 0;
		}
	}
	if (bits === 0) return " ".repeat(width);

	const glyph = bits === 255 ? "█" : String.fromCodePoint(0x2800 + bits);
	return glyph.repeat(width);
}

function barAxisValue(
	row: number,
	minimum: number,
	maximum: number,
	zeroRow: number,
): number {
	if (row === zeroRow) return 0;
	if (row === 0) return maximum;
	if (row === PLOT_ROWS - 1) return minimum;
	return (maximum + minimum) / 2;
}

function renderSparkline(points: ChartPoint[], width: number): string[] {
	const values = points.map((point) => point.value);
	const minimum = Math.min(...values);
	const maximum = Math.max(...values);
	const minimumLabel = formatNumber(minimum);
	const maximumLabel = formatNumber(maximum);
	const chartWidth = Math.max(
		4,
		width - displayWidth(minimumLabel) - displayWidth(maximumLabel) - 2,
	);
	const sampled = resample(values, chartWidth);
	const range = maximum - minimum || 1;
	const spark = sampled
		.map(
			(value) =>
				SPARK_GLYPHS[
					Math.min(7, Math.floor(((value - minimum) / range) * 8))
				] ?? "▁",
		)
		.join("");
	return [`${minimumLabel} ${spark} ${maximumLabel}`];
}

function renderBraille(
	points: ChartPoint[],
	connect: boolean,
	width: number,
): string[] {
	const yValues = points.map((point) => point.value);
	const minimum = Math.min(...yValues);
	const maximum = Math.max(...yValues);
	const range = maximum - minimum || 1;
	const middleRow = Math.floor(PLOT_ROWS / 2);
	const tickLabels = [
		formatNumber(maximum),
		formatNumber(maximum - ((maximum - minimum) * middleRow) / (PLOT_ROWS - 1)),
		formatNumber(minimum),
	];
	const yLabelWidth = Math.max(
		3,
		...tickLabels.map((label) => displayWidth(label)),
	);
	const plotColumns = width - yLabelWidth - 3;
	if (plotColumns < 4) return [];

	const dotWidth = plotColumns * 2;
	const dotHeight = PLOT_ROWS * 4;
	const dots = new Set<string>();
	const coordinates = points.map((point, index) => ({
		x:
			points.length === 1
				? 0
				: Math.round((index * (dotWidth - 1)) / (points.length - 1)),
		y:
			dotHeight -
			1 -
			Math.round(((point.value - minimum) / range) * (dotHeight - 1)),
	}));

	for (let index = 0; index < coordinates.length; index += 1) {
		const point = coordinates[index];
		if (!point) continue;
		if (connect && index > 0) {
			const previous = coordinates[index - 1];
			if (previous) drawLine(previous.x, previous.y, point.x, point.y, dots);
		} else {
			drawPoint(point.x, point.y, dotWidth, dotHeight, dots);
		}
	}

	const lines: string[] = [];
	for (let row = 0; row < PLOT_ROWS; row += 1) {
		const label =
			row === 0
				? (tickLabels[0] ?? "")
				: row === middleRow
					? (tickLabels[1] ?? "")
					: row === PLOT_ROWS - 1
						? (tickLabels[2] ?? "")
						: "";
		let chart = "";
		for (let column = 0; column < plotColumns; column += 1) {
			let bits = 0;
			for (const [dotX, dotY, bit] of BRAILLE_DOTS) {
				if (dots.has(`${column * 2 + dotX},${row * 4 + dotY}`)) bits |= bit;
			}
			chart += String.fromCodePoint(0x2800 + bits);
		}
		lines.push(`${label.padStart(yLabelWidth)} ┤${chart}`);
	}

	lines.push(`${"".padStart(yLabelWidth)} └${"─".repeat(plotColumns)}`);
	const first = truncate(points[0]?.label ?? "", Math.floor(plotColumns / 2));
	const last = truncate(
		points[points.length - 1]?.label ?? "",
		Math.floor(plotColumns / 2),
	);
	const spacer = Math.max(
		1,
		plotColumns - displayWidth(first) - displayWidth(last),
	);
	lines.push(
		`${"".padStart(yLabelWidth + 2)}${first}${" ".repeat(spacer)}${last}`,
	);
	return lines;
}

function drawLine(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	dots: Set<string>,
): void {
	let x = x0;
	let y = y0;
	const dx = Math.abs(x1 - x0);
	const sx = x0 < x1 ? 1 : -1;
	const dy = -Math.abs(y1 - y0);
	const sy = y0 < y1 ? 1 : -1;
	let error = dx + dy;

	while (true) {
		dots.add(`${x},${y}`);
		if (x === x1 && y === y1) return;
		const twice = 2 * error;
		if (twice >= dy) {
			error += dy;
			x += sx;
		}
		if (twice <= dx) {
			error += dx;
			y += sy;
		}
	}
}

function drawPoint(
	x: number,
	y: number,
	width: number,
	height: number,
	dots: Set<string>,
): void {
	const startX = x >= width - 1 ? x - 1 : x;
	const startY = y >= height - 1 ? y - 1 : y;
	for (let offsetY = 0; offsetY < 2; offsetY += 1) {
		for (let offsetX = 0; offsetX < 2; offsetX += 1) {
			const dotX = startX + offsetX;
			const dotY = startY + offsetY;
			if (dotX < width && dotY < height) dots.add(`${dotX},${dotY}`);
		}
	}
}

function renderHeatmap(rows: HeatmapRow[], width: number): string[] {
	const rowLabelWidth = Math.min(
		14,
		Math.max(3, ...rows.map((row) => displayWidth(row.label))),
	);
	const columns = Math.max(0, ...rows.map((row) => row.values.length));
	const plotWidth = width - rowLabelWidth - 3;
	if (columns === 0 || plotWidth < 1) return [];

	const allValues = rows.flatMap((row) => row.values);
	if (allValues.length === 0) return [];
	const minimum = Math.min(...allValues);
	const maximum = Math.max(...allValues);
	const range = maximum - minimum || 1;
	const visibleColumns = Math.min(columns, plotWidth);
	const columnWidths = Array.from(
		{ length: visibleColumns },
		(_, index) =>
			Math.floor(plotWidth / visibleColumns) +
			(index < plotWidth % visibleColumns ? 1 : 0),
	);
	const lines = rows.map((row) => {
		const values = resample(row.values, visibleColumns);
		const cells = values
			.map((value, index) => {
				const glyph =
					HEAT_GLYPHS[
						Math.min(3, Math.floor(((value - minimum) / range) * 4))
					] ?? "░";
				return glyph.repeat(columnWidths[index] ?? 1);
			})
			.join("");
		return `${padEndWidth(truncate(row.label, rowLabelWidth), rowLabelWidth)} │ ${cells}`;
	});
	lines.push(`${"".padStart(rowLabelWidth + 3)}${HEAT_GLYPHS}  low → high`);
	return lines;
}

function resample(values: number[], limit: number): number[] {
	if (limit <= 1) return values.length > 0 ? [values[0] ?? 0] : [];
	if (values.length === 0) return [];
	if (values.length === 1)
		return Array.from({ length: limit }, () => values[0] ?? 0);
	return Array.from({ length: limit }, (_, index) => {
		const sourcePosition = (index * (values.length - 1)) / (limit - 1);
		const lowerIndex = Math.floor(sourcePosition);
		const upperIndex = Math.ceil(sourcePosition);
		const lower = values[lowerIndex] ?? values[values.length - 1] ?? 0;
		const upper = values[upperIndex] ?? lower;
		return lower + (upper - lower) * (sourcePosition - lowerIndex);
	});
}

function formatNumber(value: number): string {
	if (Math.abs(value) >= 1000)
		return `${(value / 1000).toFixed(Math.abs(value) >= 10000 ? 0 : 1).replace(/\.0$/u, "")}k`;
	if (Number.isInteger(value)) return String(value);
	const absolute = Math.abs(value);
	if (absolute >= 1) return value.toFixed(1).replace(/\.0$/u, "");
	if (absolute >= 0.01)
		return value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
	return value.toExponential(1).replace(/\.0e/u, "e");
}

function codeSpan(line: string): string {
	const content = line || "\u00a0";
	const longestBacktickRun = Math.max(
		0,
		...Array.from(content.matchAll(/`+/gu), (match) => match[0].length),
	);
	const fence = "`".repeat(longestBacktickRun + 1);
	const padding = content.startsWith("`") || content.endsWith("`") ? " " : "";
	return `${fence}${padding}${content}${padding}${fence}`;
}

function displayWidth(value: string): number {
	return Array.from(value).reduce((width, character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		if (
			(codePoint >= 0x300 && codePoint <= 0x36f) ||
			(codePoint >= 0xfe00 && codePoint <= 0xfe0f)
		)
			return width;
		if (
			codePoint >= 0x1100 &&
			(codePoint <= 0x115f ||
				codePoint === 0x2329 ||
				codePoint === 0x232a ||
				(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
				(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
				(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
				(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
				(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
				(codePoint >= 0xff00 && codePoint <= 0xff60) ||
				(codePoint >= 0xffe0 && codePoint <= 0xffe6))
		)
			return width + 2;
		return width + 1;
	}, 0);
}

function truncate(value: string, width: number): string {
	if (displayWidth(value) <= width) return value;
	if (width <= 1) return "…";
	let output = "";
	for (const character of value) {
		if (displayWidth(`${output}${character}…`) > width) break;
		output += character;
	}
	return `${output}…`;
}

function padEndWidth(value: string, width: number): string {
	return `${value}${" ".repeat(Math.max(0, width - displayWidth(value)))}`;
}

function center(value: string, width: number): string {
	const remaining = Math.max(0, width - displayWidth(value));
	return `${" ".repeat(Math.floor(remaining / 2))}${value}${" ".repeat(Math.ceil(remaining / 2))}`;
}
