#!/usr/bin/env python3
"""Create a labeled contact sheet from a Codex pet atlas."""

# Modified from the Apache-2.0 Hatch Pet workflow for the Pi Pet authoring package.

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

COLUMNS = 8
ROWS = 9
CELL_WIDTH = 192
CELL_HEIGHT = 208
LABEL_HEIGHT = 22
ROW_NAMES = [
    "idle",
    "running-right",
    "running-left",
    "waving",
    "jumping",
    "failed",
    "waiting",
    "running",
    "review",
    "look 000-157.5",
    "look 180-337.5",
]
USED_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]
EXTENDED_NEUTRAL_LOOK_FRAME = (0, 6)


def is_used_cell(rows: int, row: int, column: int) -> bool:
    return column < USED_COUNTS[row] or (
        rows == 11 and (row, column) == EXTENDED_NEUTRAL_LOOK_FRAME
    )


def frame_count_label(rows: int, row: int) -> str:
    if rows == 11 and row == EXTENDED_NEUTRAL_LOOK_FRAME[0]:
        return "6 + neutral"
    return f"{USED_COUNTS[row]} frames"


def checker(size: tuple[int, int], square: int = 16) -> Image.Image:
    image = Image.new("RGB", size, "#ffffff")
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], square):
        for x in range(0, size[0], square):
            if (x // square + y // square) % 2:
                draw.rectangle((x, y, x + square - 1, y + square - 1), fill="#e8e8e8")
    return image


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("atlas")
    parser.add_argument("--output", required=True)
    parser.add_argument("--scale", type=float, default=0.5)
    args = parser.parse_args()

    with Image.open(Path(args.atlas).expanduser().resolve()) as opened:
        atlas = opened.convert("RGBA")
    rows = atlas.height // CELL_HEIGHT
    if atlas.width != COLUMNS * CELL_WIDTH or rows not in {9, 11}:
        raise SystemExit(f"atlas must be 1536x1872 or 1536x2288; got {atlas.width}x{atlas.height}")

    cell_w = max(1, round(CELL_WIDTH * args.scale))
    cell_h = max(1, round(CELL_HEIGHT * args.scale))
    width = COLUMNS * cell_w
    height = rows * (cell_h + LABEL_HEIGHT)
    sheet = Image.new("RGB", (width, height), "#f7f7f7")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for row in range(rows):
        y = row * (cell_h + LABEL_HEIGHT)
        draw.rectangle((0, y, width, y + LABEL_HEIGHT - 1), fill="#111111")
        draw.text((6, y + 5), f"row {row}: {ROW_NAMES[row]}", fill="#ffffff", font=font)
        draw.text(
            (width - 92, y + 5),
            frame_count_label(rows, row),
            fill="#ffffff",
            font=font,
        )
        for column in range(COLUMNS):
            crop = atlas.crop(
                (
                    column * CELL_WIDTH,
                    row * CELL_HEIGHT,
                    (column + 1) * CELL_WIDTH,
                    (row + 1) * CELL_HEIGHT,
                )
            )
            crop = crop.resize((cell_w, cell_h), Image.Resampling.LANCZOS)
            bg = checker((cell_w, cell_h))
            bg.paste(crop, (0, 0), crop)
            x = column * cell_w
            sheet.paste(bg, (x, y + LABEL_HEIGHT))
            outline = "#18a058" if is_used_cell(rows, row, column) else "#cc3344"
            draw.rectangle(
                (x, y + LABEL_HEIGHT, x + cell_w - 1, y + LABEL_HEIGHT + cell_h - 1),
                outline=outline,
            )
            draw.text((x + 4, y + LABEL_HEIGHT + 4), str(column), fill="#111111", font=font)

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)
    print(f"wrote {output}")


if __name__ == "__main__":
    main()
