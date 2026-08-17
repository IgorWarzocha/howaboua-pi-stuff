#!/usr/bin/env python3
"""Create a focused QA sheet for extended pet look directions."""

# Modified from the Apache-2.0 Hatch Pet workflow for the Pi Pet authoring package.

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

COLUMNS = 8
ROWS = 11
CELL_WIDTH = 192
CELL_HEIGHT = 208
LOOK_ROW_INDEX = 9
NEUTRAL_ROW_INDEX = 0
NEUTRAL_COLUMN_INDEX = 6
LABEL_HEIGHT = 26
FOCUS_PADDING = 18
LOOK_DIRECTION_LABELS = [
    ("000", "up"),
    ("022.5", "up-right"),
    ("045", "up-right"),
    ("067.5", "up-right"),
    ("090", "right"),
    ("112.5", "down-right"),
    ("135", "down-right"),
    ("157.5", "down-right"),
    ("180", "down"),
    ("202.5", "down-left"),
    ("225", "down-left"),
    ("247.5", "down-left"),
    ("270", "left"),
    ("292.5", "up-left"),
    ("315", "up-left"),
    ("337.5", "up-left"),
]


def paste_labeled_cell(
    sheet: Image.Image,
    atlas: Image.Image,
    *,
    label: str,
    row_index: int,
    column_index: int,
    output_column: int,
    output_row: int,
) -> None:
    draw = ImageDraw.Draw(sheet)
    x = output_column * CELL_WIDTH
    y = output_row * (CELL_HEIGHT + LABEL_HEIGHT)
    cell = atlas.crop(
        (
            column_index * CELL_WIDTH,
            row_index * CELL_HEIGHT,
            (column_index + 1) * CELL_WIDTH,
            (row_index + 1) * CELL_HEIGHT,
        )
    )
    background = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (242, 242, 242, 255))
    sheet.alpha_composite(background, (x, y + LABEL_HEIGHT))
    sheet.alpha_composite(cell, (x, y + LABEL_HEIGHT))
    draw.text((x + 6, y + 7), label, fill=(0, 0, 0, 255))


def focused_head_cell(cell: Image.Image) -> Image.Image:
    bbox = cell.getbbox()
    if bbox is None:
        return cell

    left, top, right, bottom = bbox
    sprite_height = bottom - top
    focus_bottom = top + max(1, int(sprite_height * 0.52))
    crop_box = (
        max(0, left - FOCUS_PADDING),
        max(0, top - FOCUS_PADDING),
        min(CELL_WIDTH, right + FOCUS_PADDING),
        min(CELL_HEIGHT, focus_bottom + FOCUS_PADDING),
    )
    crop = cell.crop(crop_box)
    focused = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (0, 0, 0, 0))
    crop.thumbnail((CELL_WIDTH, CELL_HEIGHT), Image.Resampling.LANCZOS)
    focused.alpha_composite(
        crop,
        ((CELL_WIDTH - crop.width) // 2, (CELL_HEIGHT - crop.height) // 2),
    )
    return focused


def paste_labeled_focus_cell(
    sheet: Image.Image,
    atlas: Image.Image,
    *,
    label: str,
    row_index: int,
    column_index: int,
    output_column: int,
    output_row: int,
) -> None:
    cell = atlas.crop(
        (
            column_index * CELL_WIDTH,
            row_index * CELL_HEIGHT,
            (column_index + 1) * CELL_WIDTH,
            (row_index + 1) * CELL_HEIGHT,
        )
    )
    focused = focused_head_cell(cell)
    background = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (242, 242, 242, 255))
    x = output_column * CELL_WIDTH
    y = output_row * (CELL_HEIGHT + LABEL_HEIGHT)
    sheet.alpha_composite(background, (x, y + LABEL_HEIGHT))
    sheet.alpha_composite(focused, (x, y + LABEL_HEIGHT))
    ImageDraw.Draw(sheet).text((x + 6, y + 7), label, fill=(0, 0, 0, 255))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("atlas")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    with Image.open(Path(args.atlas).expanduser().resolve()) as opened:
        atlas = opened.convert("RGBA")
    if atlas.size != (COLUMNS * CELL_WIDTH, ROWS * CELL_HEIGHT):
        raise SystemExit(f"extended atlas must be 1536x2288; got {atlas.width}x{atlas.height}")

    sheet = Image.new(
        "RGBA",
        (COLUMNS * CELL_WIDTH, 5 * (CELL_HEIGHT + LABEL_HEIGHT)),
        (255, 255, 255, 255),
    )
    paste_labeled_cell(
        sheet,
        atlas,
        label="neutral",
        row_index=NEUTRAL_ROW_INDEX,
        column_index=NEUTRAL_COLUMN_INDEX,
        output_column=0,
        output_row=0,
    )
    for index, (label, expected_direction) in enumerate(LOOK_DIRECTION_LABELS):
        paste_labeled_cell(
            sheet,
            atlas,
            label=f"{label} {expected_direction}",
            row_index=LOOK_ROW_INDEX + index // COLUMNS,
            column_index=index % COLUMNS,
            output_column=index % COLUMNS,
            output_row=1 + index // COLUMNS,
        )
        paste_labeled_focus_cell(
            sheet,
            atlas,
            label=f"zoom {label} {expected_direction}",
            row_index=LOOK_ROW_INDEX + index // COLUMNS,
            column_index=index % COLUMNS,
            output_column=index % COLUMNS,
            output_row=3 + index // COLUMNS,
        )

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(output)
    print(f"wrote {output}")


if __name__ == "__main__":
    main()
