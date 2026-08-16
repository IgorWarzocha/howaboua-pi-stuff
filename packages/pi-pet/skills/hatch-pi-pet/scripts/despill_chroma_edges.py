#!/usr/bin/env python3
"""Remove chroma-key matte contamination from transparent sprite edges."""

# Modified from the Apache-2.0 Hatch Pet workflow for current Pillow pixel access.

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from PIL import Image, ImageFilter

CELL_WIDTH = 192
CELL_HEIGHT = 208
ALGORITHM = "edge-local-chroma-spill-suppression"


def parse_hex_color(value: str) -> tuple[int, int, int]:
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise SystemExit(f"invalid chroma key color: {value}; expected #RRGGBB")
    return tuple(int(value[index : index + 2], 16) for index in (1, 3, 5))


def srgb_to_linear(value: float) -> float:
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def linear_to_srgb(value: float) -> float:
    if value <= 0.0031308:
        return value * 12.92
    return 1.055 * value ** (1 / 2.4) - 0.055


def edge_band(alpha: Image.Image, radius: int) -> list[bool]:
    visible = [value > 0 for value in alpha.get_flattened_data()]
    transparent = Image.new("L", alpha.size)
    transparent.putdata([0 if value else 255 for value in visible])
    expanded = transparent.filter(ImageFilter.MaxFilter(radius * 2 + 1))
    return [
        is_visible and nearby > 0
        for is_visible, nearby in zip(visible, expanded.get_flattened_data())
    ]


def atlas_edge_band(alpha: Image.Image, radius: int) -> list[bool]:
    width, height = alpha.size
    boundary = edge_band(alpha, radius)
    if width % CELL_WIDTH or height % CELL_HEIGHT:
        return boundary

    for top in range(0, height, CELL_HEIGHT):
        for left in range(0, width, CELL_WIDTH):
            cell = alpha.crop((left, top, left + CELL_WIDTH, top + CELL_HEIGHT))
            for index, is_boundary in enumerate(edge_band(cell, radius)):
                if is_boundary:
                    x = left + index % CELL_WIDTH
                    y = top + index // CELL_WIDTH
                    boundary[y * width + x] = True
    return boundary


def chroma_similarity(
    color: tuple[float, float, float],
    key: tuple[float, float, float],
) -> float:
    color_mean = sum(color) / 3
    key_mean = sum(key) / 3
    color_chroma = tuple(channel - color_mean for channel in color)
    key_chroma = tuple(channel - key_mean for channel in key)
    denominator = sum(channel * channel for channel in color_chroma) * sum(
        channel * channel for channel in key_chroma
    )
    if denominator <= 1e-12:
        return -1
    return (
        sum(
            color_channel * key_channel
            for color_channel, key_channel in zip(color_chroma, key_chroma)
        )
        / denominator**0.5
    )


def chroma_saturation(color: tuple[float, float, float]) -> float:
    maximum = max(color)
    if maximum <= 0:
        return 0
    return (maximum - min(color)) / maximum


def suppress_boundary_spill(
    pixels: list[tuple[int, int, int, int]],
    *,
    size: tuple[int, int],
    boundary: list[bool],
    key_linear: tuple[float, float, float],
    strength: float,
    edge_radius: int,
    spill_tolerance: float,
    minimum_saturation: float,
) -> tuple[list[tuple[int, int, int, int]], list[bool]]:
    width, height = size
    colors_linear = [
        tuple(srgb_to_linear(channel / 255) for channel in pixel[:3]) for pixel in pixels
    ]
    similarity_threshold = 1 - min(spill_tolerance, 1)
    pending = [
        pixel[3] > 0
        and is_boundary
        and (
            pixel[3] < 250
            or (
                chroma_saturation(color) >= minimum_saturation
                and chroma_similarity(color, key_linear) >= similarity_threshold
            )
        )
        for pixel, color, is_boundary in zip(pixels, colors_linear, boundary)
    ]
    filled = [pixel[3] > 0 and not is_pending for pixel, is_pending in zip(pixels, pending)]
    output = pixels.copy()
    suppressed = [False] * len(pixels)
    cell_width = CELL_WIDTH if width % CELL_WIDTH == 0 else width
    cell_height = CELL_HEIGHT if height % CELL_HEIGHT == 0 else height

    for _ in range(edge_radius * 2 + 1):
        updates: list[tuple[int, tuple[float, float, float]]] = []
        for index, is_pending in enumerate(pending):
            if not is_pending:
                continue
            x = index % width
            y = index // width
            cell_left = x // cell_width * cell_width
            cell_top = y // cell_height * cell_height
            references = []
            for neighbor_y in range(
                max(cell_top, y - 1),
                min(cell_top + cell_height, y + 2),
            ):
                for neighbor_x in range(
                    max(cell_left, x - 1),
                    min(cell_left + cell_width, x + 2),
                ):
                    neighbor = neighbor_y * width + neighbor_x
                    if neighbor != index and filled[neighbor]:
                        references.append(colors_linear[neighbor])
            if not references:
                continue

            reference = tuple(
                sum(color[channel] for color in references) / len(references)
                for channel in range(3)
            )
            observed = colors_linear[index]
            cleaned = tuple(
                channel + (reference_channel - channel) * strength
                for channel, reference_channel in zip(observed, reference)
            )
            updates.append((index, cleaned))

        if not updates:
            break
        for index, cleaned in updates:
            colors_linear[index] = cleaned
            filled[index] = True
            pending[index] = False
            output[index] = (
                *(round(linear_to_srgb(min(1, max(0, channel))) * 255) for channel in cleaned),
                pixels[index][3],
            )
            suppressed[index] = output[index] != pixels[index]

    for index, is_pending in enumerate(pending):
        if not is_pending:
            continue
        observed = colors_linear[index]
        luminance = sum(observed) / 3
        cleaned = tuple(channel + (luminance - channel) * strength for channel in observed)
        output[index] = (
            *(round(linear_to_srgb(min(1, max(0, channel))) * 255) for channel in cleaned),
            pixels[index][3],
        )
        suppressed[index] = output[index] != pixels[index]

    return output, suppressed


def decontaminate_image(
    image: Image.Image,
    *,
    chroma_key: tuple[int, int, int],
    strength: float = 1,
    edge_radius: int = 5,
    spill_tolerance: float = 0.15,
    minimum_saturation: float = 0.1,
) -> tuple[Image.Image, dict[str, object]]:
    if not 0 <= strength <= 1:
        raise ValueError("strength must be between 0 and 1")
    if edge_radius < 1:
        raise ValueError("edge_radius must be at least 1")
    if spill_tolerance < 0:
        raise ValueError("spill_tolerance must not be negative")
    if minimum_saturation < 0:
        raise ValueError("minimum_saturation must not be negative")

    rgba = image.convert("RGBA")
    width, _ = rgba.size
    source = list(rgba.get_flattened_data())
    boundary = atlas_edge_band(rgba.getchannel("A"), edge_radius)
    key_linear = tuple(srgb_to_linear(channel / 255) for channel in chroma_key)
    output_pixels, suppressed = suppress_boundary_spill(
        source,
        size=rgba.size,
        boundary=boundary,
        key_linear=key_linear,
        strength=strength,
        edge_radius=edge_radius,
        spill_tolerance=spill_tolerance,
        minimum_saturation=minimum_saturation,
    )
    output_pixels = [
        (0, 0, 0, 0) if pixel[3] == 0 else output_pixel
        for pixel, output_pixel in zip(source, output_pixels)
    ]
    decontaminated_pixels = sum(
        is_suppressed and pixel[3] < 255 for pixel, is_suppressed in zip(source, suppressed)
    )
    spill_suppressed_pixels = sum(suppressed)

    changed_by_cell: dict[str, int] = {}
    for index, (source_pixel, output_pixel) in enumerate(zip(source, output_pixels)):
        if output_pixel != source_pixel:
            x = index % width
            y = index // width
            cell = f"r{y // CELL_HEIGHT}c{x // CELL_WIDTH}"
            changed_by_cell[cell] = changed_by_cell.get(cell, 0) + 1

    output = Image.new("RGBA", rgba.size)
    output.putdata(output_pixels)
    return output, {
        "algorithm": ALGORITHM,
        "strength": strength,
        "edge_radius": edge_radius,
        "spill_tolerance": spill_tolerance,
        "minimum_saturation": minimum_saturation,
        "changed_pixels": sum(changed_by_cell.values()),
        "decontaminated_pixels": decontaminated_pixels,
        "spill_suppressed_pixels": spill_suppressed_pixels,
        "rejected_pixels": 0,
        "changed_by_cell": dict(
            sorted(changed_by_cell.items(), key=lambda item: item[1], reverse=True)
        ),
        "alpha_preserved": True,
    }


def save_image(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".webp":
        image.save(path, format="WEBP", lossless=True, quality=100, method=6, exact=True)
    else:
        image.save(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input")
    parser.add_argument("--output", required=True)
    parser.add_argument("--webp-output")
    parser.add_argument("--json-out")
    parser.add_argument("--chroma-key", required=True)
    parser.add_argument("--strength", type=float, default=1)
    parser.add_argument("--edge-radius", type=int, default=5)
    parser.add_argument("--spill-tolerance", type=float, default=0.15)
    parser.add_argument("--minimum-saturation", type=float, default=0.1)
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    with Image.open(input_path) as opened:
        cleaned, report = decontaminate_image(
            opened,
            chroma_key=parse_hex_color(args.chroma_key),
            strength=args.strength,
            edge_radius=args.edge_radius,
            spill_tolerance=args.spill_tolerance,
            minimum_saturation=args.minimum_saturation,
        )

    output_path = Path(args.output).expanduser().resolve()
    save_image(cleaned, output_path)
    if args.webp_output:
        save_image(cleaned, Path(args.webp_output).expanduser().resolve())

    result = {
        "ok": True,
        "input": str(input_path),
        "output": str(output_path),
        "chroma_key": args.chroma_key.upper(),
        **report,
    }
    if args.json_out:
        json_path = Path(args.json_out).expanduser().resolve()
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
