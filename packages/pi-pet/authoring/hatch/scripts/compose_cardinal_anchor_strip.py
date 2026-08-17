#!/usr/bin/env python3
"""Compose approved cardinal reference cells."""

# Modified from the Apache-2.0 Hatch Pet workflow for the Pi Pet authoring package.

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

CELL_SIZE = (192, 208)
CARDINALS = ("000", "090", "180", "270")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--anchors-dir", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    anchors_dir = Path(args.anchors_dir).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    strip = Image.new("RGBA", (CELL_SIZE[0] * len(CARDINALS), CELL_SIZE[1]))

    for index, direction in enumerate(CARDINALS):
        path = anchors_dir / f"{direction}.png"
        if not path.is_file():
            raise SystemExit(f"missing approved cardinal reference: {path}")
        with Image.open(path) as opened:
            reference = opened.convert("RGBA")
        if reference.size != CELL_SIZE:
            raise SystemExit(f"{path} is {reference.size}; expected {CELL_SIZE}")
        if reference.getbbox() is None:
            raise SystemExit(f"approved cardinal reference is empty: {path}")
        strip.alpha_composite(reference, (index * CELL_SIZE[0], 0))

    output.parent.mkdir(parents=True, exist_ok=True)
    strip.save(output)
    print(f"wrote {output}")


if __name__ == "__main__":
    main()
