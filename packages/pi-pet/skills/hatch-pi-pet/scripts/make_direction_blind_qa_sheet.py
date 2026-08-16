#!/usr/bin/env python3
"""Create an unlabeled A/B direction-pair sheet and a hidden answer key."""

# Modified from the Apache-2.0 Hatch Pet workflow for the Pi Pet authoring package.

from __future__ import annotations

import argparse
import hashlib
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw

COLUMNS = 8
ROWS = 11
CELL_WIDTH = 192
CELL_HEIGHT = 208
LOOK_ROW_INDEX = 9
LABEL_HEIGHT = 28
PAIR_COLUMNS = 2

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

AXIS_PAIRS = [
    ("horizontal", "022.5", "screen-right", "337.5", "screen-left"),
    ("horizontal", "045", "screen-right", "315", "screen-left"),
    ("horizontal", "067.5", "screen-right", "292.5", "screen-left"),
    ("horizontal", "090", "screen-right", "270", "screen-left"),
    ("horizontal", "112.5", "screen-right", "247.5", "screen-left"),
    ("horizontal", "135", "screen-right", "225", "screen-left"),
    ("horizontal", "157.5", "screen-right", "202.5", "screen-left"),
    ("vertical", "000", "up", "180", "down"),
    ("vertical", "022.5", "up", "157.5", "down"),
    ("vertical", "045", "up", "135", "down"),
    ("vertical", "067.5", "up", "112.5", "down"),
    ("vertical", "337.5", "up", "202.5", "down"),
    ("vertical", "315", "up", "225", "down"),
    ("vertical", "292.5", "up", "247.5", "down"),
]


def atlas_cell(atlas: Image.Image, label: str) -> Image.Image:
    index = LOOK_DIRECTION_LABELS.index(label)
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


def paste_cell(
    sheet: Image.Image,
    cell: Image.Image,
    *,
    label: str,
    column: int,
    row: int,
) -> None:
    x = column * CELL_WIDTH
    y = row * (CELL_HEIGHT + LABEL_HEIGHT)
    sheet.alpha_composite(
        Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (242, 242, 242, 255)),
        (x, y + LABEL_HEIGHT),
    )
    sheet.alpha_composite(cell, (x, y + LABEL_HEIGHT))
    ImageDraw.Draw(sheet).text((x + 6, y + 8), label, fill=(0, 0, 0, 255))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("atlas")
    parser.add_argument("--output", required=True)
    parser.add_argument("--answer-key", required=True)
    args = parser.parse_args()

    atlas_path = Path(args.atlas).expanduser().resolve()
    with Image.open(atlas_path) as opened:
        atlas = opened.convert("RGBA")
    if atlas.size != (COLUMNS * CELL_WIDTH, ROWS * CELL_HEIGHT):
        raise SystemExit(f"extended atlas must be 1536x2288; got {atlas.width}x{atlas.height}")

    seed = int.from_bytes(hashlib.sha256(atlas.tobytes()).digest()[:8], "big")
    rng = random.Random(seed)
    sheet = Image.new(
        "RGBA",
        (
            PAIR_COLUMNS * CELL_WIDTH,
            len(AXIS_PAIRS) * (CELL_HEIGHT + LABEL_HEIGHT),
        ),
        (255, 255, 255, 255),
    )
    answers: list[dict[str, object]] = []

    axis_indexes = {"horizontal": 0, "vertical": 0}
    for row, (axis, first_label, first_direction, second_label, second_direction) in enumerate(
        AXIS_PAIRS
    ):
        axis_indexes[axis] += 1
        pair_id = f"{axis}-{axis_indexes[axis]}"
        pair = [
            (first_label, first_direction),
            (second_label, second_direction),
        ]
        rng.shuffle(pair)
        cells: list[tuple[str, str, Image.Image]] = []
        for source_label, expected_direction in pair:
            cells.append((source_label, expected_direction, atlas_cell(atlas, source_label)))

        label = f"{axis.title()} pair {axis_indexes[axis]}"
        paste_cell(sheet, cells[0][2], label=f"{label} A", column=0, row=row)
        paste_cell(sheet, cells[1][2], label=f"{label} B", column=1, row=row)
        answers.append(
            {
                "pair": pair_id,
                "axis": axis,
                "gate": (
                    "hard"
                    if {first_label, second_label} in ({"000", "180"}, {"090", "270"})
                    else "review"
                ),
                "A": {
                    "expected_direction": cells[0][1],
                    "source_direction": cells[0][0],
                },
                "B": {
                    "expected_direction": cells[1][1],
                    "source_direction": cells[1][0],
                },
            }
        )

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(output)
    answer_key = Path(args.answer_key).expanduser().resolve()
    answer_key.parent.mkdir(parents=True, exist_ok=True)
    answer_key.write_text(
        json.dumps(
            {
                "schema_version": 3,
                "atlas_sha256": hashlib.sha256(atlas_path.read_bytes()).hexdigest(),
                "instructions": "Do not provide this answer key to the blind visual QA reviewer.",
                "pairs": answers,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {output}")
    print(f"wrote {answer_key}")


if __name__ == "__main__":
    main()
