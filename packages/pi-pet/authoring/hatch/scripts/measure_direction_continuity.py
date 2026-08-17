#!/usr/bin/env python3
"""Measure adjacent-pair continuity for extended pet look directions."""

# Modified from the Apache-2.0 Hatch Pet workflow for current Pillow pixel access.

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

from PIL import Image, ImageChops

COLUMNS = 8
ROWS = 11
CELL_WIDTH = 192
CELL_HEIGHT = 208
LOOK_ROW_INDEX = 9
LOOK_DIRECTION_LABELS = [
    "000",
    "022.5",
    "045",
    "067.5",
    "090",
    "112.5",
    "135",
    "157.5",
    "180",
    "202.5",
    "225",
    "247.5",
    "270",
    "292.5",
    "315",
    "337.5",
]


def nontransparent_pixels(image: Image.Image) -> int:
    return sum(1 for alpha in image.getchannel("A").get_flattened_data() if alpha > 16)


def center_for_bbox(bbox: tuple[int, int, int, int] | None) -> tuple[float, float] | None:
    if bbox is None:
        return None
    left, top, right, bottom = bbox
    return ((left + right) / 2, (top + bottom) / 2)


def cell_from_atlas(atlas: Image.Image, index: int) -> Image.Image:
    row = LOOK_ROW_INDEX + index // COLUMNS
    column = index % COLUMNS
    return atlas.crop(
        (
            column * CELL_WIDTH,
            row * CELL_HEIGHT,
            (column + 1) * CELL_WIDTH,
            (row + 1) * CELL_HEIGHT,
        )
    )


def transparent_hole_rows(image: Image.Image) -> list[dict[str, int]]:
    alpha = list(image.getchannel("A").get_flattened_data())
    rows = [alpha[index * CELL_WIDTH : (index + 1) * CELL_WIDTH] for index in range(CELL_HEIGHT)]
    holes = []
    for y in range(1, CELL_HEIGHT - 1):
        prev_xs = [x for x, value in enumerate(rows[y - 1]) if value > 16]
        next_xs = [x for x, value in enumerate(rows[y + 1]) if value > 16]
        if not prev_xs or not next_xs:
            continue
        left = max(min(prev_xs), min(next_xs))
        right = min(max(prev_xs), max(next_xs))
        if right <= left:
            continue
        span = rows[y][left : right + 1]
        transparent_pixels = sum(1 for value in span if value <= 16)
        if len(span) >= 64 and transparent_pixels > max(32, int(len(span) * 0.25)):
            holes.append(
                {
                    "row": y,
                    "transparentPixels": transparent_pixels,
                    "spanPixels": len(span),
                }
            )
    return holes


def pair_metric(first: Image.Image, second: Image.Image) -> dict[str, float | int | None]:
    first_bbox = first.getbbox()
    second_bbox = second.getbbox()
    first_center = center_for_bbox(first_bbox)
    second_center = center_for_bbox(second_bbox)
    first_pixels = nontransparent_pixels(first)
    second_pixels = nontransparent_pixels(second)
    diff = ImageChops.difference(first, second)
    diff_pixels = nontransparent_pixels(diff)

    if first_center is None or second_center is None:
        center_delta = None
    else:
        center_delta = (
            (first_center[0] - second_center[0]) ** 2 + (first_center[1] - second_center[1]) ** 2
        ) ** 0.5

    if first_pixels == 0 or second_pixels == 0:
        area_ratio = None
    else:
        area_ratio = max(first_pixels, second_pixels) / min(first_pixels, second_pixels)

    return {
        "firstPixels": first_pixels,
        "secondPixels": second_pixels,
        "diffPixels": diff_pixels,
        "centerDelta": center_delta,
        "areaRatio": area_ratio,
    }


def median(values: list[float]) -> float:
    if not values:
        return 0
    return statistics.median(values)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("atlas")
    parser.add_argument("--json-out", required=True)
    parser.add_argument("--diff-outlier-ratio", type=float, default=1.45)
    parser.add_argument("--center-delta-warning", type=float, default=8)
    parser.add_argument("--area-ratio-warning", type=float, default=1.15)
    args = parser.parse_args()

    with Image.open(Path(args.atlas).expanduser().resolve()) as opened:
        atlas = opened.convert("RGBA")
    if atlas.size != (COLUMNS * CELL_WIDTH, ROWS * CELL_HEIGHT):
        raise SystemExit(f"extended atlas must be 1536x2288; got {atlas.width}x{atlas.height}")

    cells = [cell_from_atlas(atlas, index) for index in range(len(LOOK_DIRECTION_LABELS))]
    pairs = []
    for index, label in enumerate(LOOK_DIRECTION_LABELS):
        next_index = (index + 1) % len(LOOK_DIRECTION_LABELS)
        next_label = LOOK_DIRECTION_LABELS[next_index]
        pairs.append(
            {
                "from": label,
                "to": next_label,
                **pair_metric(cells[index], cells[next_index]),
            }
        )

    diff_values = [float(pair["diffPixels"]) for pair in pairs]
    median_diff = median(diff_values)
    warnings = []
    alpha_holes = []
    for label, cell in zip(LOOK_DIRECTION_LABELS, cells, strict=True):
        holes = transparent_hole_rows(cell)
        if holes:
            alpha_holes.append({"direction": label, "holes": holes})
            preview = ", ".join(f"y={hole['row']}" for hole in holes[:4])
            suffix = "" if len(holes) <= 4 else f", +{len(holes) - 4} more"
            warnings.append(f"{label} has transparent interior hole rows ({preview}{suffix})")

    for index, pair in enumerate(pairs):
        diff_pixels = float(pair["diffPixels"])
        center_delta = pair["centerDelta"]
        area_ratio = pair["areaRatio"]
        pair_label = f"{pair['from']}->{pair['to']}"
        neighbor_diff = statistics.mean(
            [
                diff_values[(index - 1) % len(diff_values)],
                diff_values[(index + 1) % len(diff_values)],
            ]
        )
        if neighbor_diff and diff_pixels > neighbor_diff * args.diff_outlier_ratio:
            warnings.append(
                f"{pair_label} diff is a local outlier ({diff_pixels:.0f} pixels vs neighbor average {neighbor_diff:.0f})"
            )
        if isinstance(center_delta, float) and center_delta > args.center_delta_warning:
            warnings.append(f"{pair_label} center shift is high ({center_delta:.1f}px)")
        if isinstance(area_ratio, float) and area_ratio > args.area_ratio_warning:
            warnings.append(f"{pair_label} sprite area ratio is high ({area_ratio:.2f})")

    result = {
        "ok": True,
        "reviewRequired": bool(warnings),
        "medianDiffPixels": median_diff,
        "warnings": warnings,
        "alphaHoles": alpha_holes,
        "pairs": pairs,
    }
    output = Path(args.json_out).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
