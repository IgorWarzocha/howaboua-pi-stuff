import importlib.util
import io
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from PIL import Image, ImageDraw

SKILL_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = SKILL_DIR / "scripts" / "assemble_extended_atlas.py"
sys.path.insert(0, str(MODULE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("assemble_extended_atlas", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load {MODULE_PATH}")
ASSEMBLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ASSEMBLER)


class AssembleExtendedAtlasTest(unittest.TestCase):
    def test_row_9_can_be_registered_before_row_10_is_generated(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            atlas_path = root / "base.png"
            neutral_path = root / "neutral.png"
            strip_path = root / "look-row-9.png"
            output_path = root / "registered-row-9.png"
            registration_path = root / "row-9-registration.json"

            Image.new("RGBA", (1536, 1872), (0, 0, 0, 0)).save(atlas_path)
            neutral = Image.new("RGBA", (192, 208), (0, 0, 0, 0))
            ImageDraw.Draw(neutral).rectangle((40, 18, 151, 197), fill="white")
            neutral.save(neutral_path)

            strip = Image.new("RGB", (2176, 724), "#FF00FF")
            draw = ImageDraw.Draw(strip)
            slot_width = strip.width // 8
            for index in range(8):
                left = index * slot_width + 64
                draw.rectangle((left, 100, left + 140, 620), fill=(20 + index, 40, 80))
            strip.save(strip_path)

            subprocess.run(
                [
                    sys.executable,
                    str(MODULE_PATH),
                    "--base-atlas",
                    str(atlas_path),
                    "--look-row-9",
                    str(strip_path),
                    "--neutral-cell",
                    str(neutral_path),
                    "--chroma-key",
                    "#FF00FF",
                    "--registered-row-output",
                    str(output_path),
                    "--registration-manifest-output",
                    str(registration_path),
                ],
                check=True,
                capture_output=True,
                text=True,
            )

            with Image.open(output_path) as registered:
                self.assertEqual(registered.size, (1536, 208))
                self.assertTrue(
                    all(
                        registered.crop((column * 192, 0, (column + 1) * 192, 208)).getbbox()
                        for column in range(8)
                    )
                )
            self.assertTrue(registration_path.is_file())

    def test_registration_manifest_rejects_a_different_registered_row(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            row = root / "registered.png"
            manifest = root / "registration.json"
            Image.new("RGBA", (1536, 208), "white").save(row)
            with redirect_stdout(io.StringIO()):
                ASSEMBLER.write_registration_manifest(manifest, 0.75, row)
            Image.new("RGBA", (1536, 208), "black").save(row)

            with self.assertRaisesRegex(SystemExit, "does not match"):
                ASSEMBLER.load_registration_scale(manifest, row)

    def test_final_assembly_preserves_registered_row_9_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            atlas_path = root / "base.png"
            neutral_path = root / "neutral.png"
            row_9_path = root / "look-row-9.png"
            row_10_path = root / "look-row-10.png"
            registered_path = root / "registered-row-9.png"
            registration_path = root / "row-9-registration.json"
            output_path = root / "extended.png"

            Image.new("RGBA", (1536, 1872), (0, 0, 0, 0)).save(atlas_path)
            neutral = Image.new("RGBA", (192, 208), (0, 0, 0, 0))
            ImageDraw.Draw(neutral).rectangle((40, 18, 151, 197), fill="white")
            neutral.save(neutral_path)

            for path, height in ((row_9_path, 500), (row_10_path, 520)):
                strip = Image.new("RGB", (2176, 724), "#FF00FF")
                draw = ImageDraw.Draw(strip)
                slot_width = strip.width // 8
                for index in range(8):
                    left = index * slot_width + 64
                    draw.rectangle(
                        (left, 650 - height, left + 140, 649),
                        fill=(20 + index, 40, 80),
                    )
                strip.save(path)

            subprocess.run(
                [
                    sys.executable,
                    str(MODULE_PATH),
                    "--base-atlas",
                    str(atlas_path),
                    "--look-row-9",
                    str(row_9_path),
                    "--neutral-cell",
                    str(neutral_path),
                    "--chroma-key",
                    "#FF00FF",
                    "--registered-row-output",
                    str(registered_path),
                    "--registration-manifest-output",
                    str(registration_path),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            subprocess.run(
                [
                    sys.executable,
                    str(MODULE_PATH),
                    "--base-atlas",
                    str(atlas_path),
                    "--registered-row-9",
                    str(registered_path),
                    "--row-9-registration",
                    str(registration_path),
                    "--look-row-10",
                    str(row_10_path),
                    "--neutral-cell",
                    str(neutral_path),
                    "--chroma-key",
                    "#FF00FF",
                    "--output",
                    str(output_path),
                ],
                check=True,
                capture_output=True,
                text=True,
            )

            with Image.open(registered_path) as registered, Image.open(output_path) as atlas:
                self.assertEqual(
                    registered.convert("RGBA").tobytes(),
                    atlas.crop((0, 9 * 208, 1536, 10 * 208)).convert("RGBA").tobytes(),
                )

    def test_look_rows_register_poses_before_one_shared_resize(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            strip_path = Path(temporary_directory) / "look-row-9.png"
            strip = Image.new("RGB", (2176, 724), "#FF00FF")
            draw = ImageDraw.Draw(strip)
            source_heights = []
            source_lefts = [220, 410, 650, 890, 1130, 1370, 1610, 1850]
            for index in range(8):
                height = 520 - index * 20
                source_heights.append(height)
                left = source_lefts[index]
                top = strip.height - height - 42
                draw.rectangle(
                    (left, top, left + 163, top + height - 1),
                    fill=(20 + index, 40, 80),
                )
                for y in range(top + 4, top + height - 4, 4):
                    draw.line((left + 4, y, left + 159, y), fill=(240, 240, 240))
            strip.save(strip_path)

            neutral = Image.new("RGBA", (192, 208), (0, 0, 0, 0))
            ImageDraw.Draw(neutral).rectangle((40, 18, 151, 197), fill="white")

            cells = ASSEMBLER.extract_row_strip_cells(
                strip_path,
                (255, 0, 255),
                16,
            )
            self.assertEqual(len(cells), 8)
            normalized = ASSEMBLER.normalize_cells_to_reference(cells, neutral)

            ASSEMBLER.validate_normalized_look_cells(normalized, 0, 2, 24)

            self.assertEqual({cell.size for cell in normalized}, {(192, 208)})

            normalized_heights = [cell.getbbox()[3] - cell.getbbox()[1] for cell in normalized]
            self.assertEqual(normalized_heights[0], 180)
            for source_height, normalized_height in zip(
                source_heights,
                normalized_heights,
            ):
                self.assertAlmostEqual(
                    normalized_height / normalized_heights[0],
                    source_height / source_heights[0],
                    delta=0.01,
                )

    def test_post_registration_edge_failure_requires_resynthesis(self) -> None:
        cell = Image.new("RGBA", (192, 208), (0, 0, 0, 0))
        ImageDraw.Draw(cell).rectangle((0, 20, 80, 180), fill="white")

        with self.assertRaisesRegex(SystemExit, "after deterministic registration"):
            ASSEMBLER.validate_normalized_look_cells([cell], 0, 2, 24)

    def test_look_rows_do_not_upscale_small_source_poses(self) -> None:
        neutral = Image.new("RGBA", (192, 208), (0, 0, 0, 0))
        ImageDraw.Draw(neutral).rectangle((40, 18, 151, 197), fill="white")
        cells = []
        for _ in range(8):
            cell = Image.new("RGBA", (192, 208), (0, 0, 0, 0))
            ImageDraw.Draw(cell).rectangle((60, 80, 131, 179), fill="white")
            cells.append(cell)

        normalized = ASSEMBLER.normalize_cells_to_reference(cells, neutral)

        self.assertEqual(
            [cell.getbbox()[3] - cell.getbbox()[1] for cell in normalized],
            [100] * 8,
        )

    def test_shared_scale_keeps_asymmetric_pose_inside_final_edges(self) -> None:
        neutral = Image.new("RGBA", (192, 208), (0, 0, 0, 0))
        ImageDraw.Draw(neutral).rectangle((40, 18, 151, 197), fill="white")
        cell = Image.new("RGBA", (300, 300), (0, 0, 0, 0))
        draw = ImageDraw.Draw(cell)
        draw.rectangle((0, 20, 299, 50), fill="white")
        draw.rectangle((0, 20, 50, 279), fill="white")

        normalized = ASSEMBLER.normalize_cells_to_reference([cell], neutral)

        ASSEMBLER.validate_normalized_look_cells(normalized, 0, 2, 24)


if __name__ == "__main__":
    unittest.main()
