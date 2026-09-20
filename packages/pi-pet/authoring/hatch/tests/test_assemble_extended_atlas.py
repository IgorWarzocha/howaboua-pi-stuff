import importlib.util
import io
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from PIL import Image, ImageDraw

HATCH_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = HATCH_DIR / "scripts" / "assemble_extended_atlas.py"
sys.path.insert(0, str(MODULE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("assemble_extended_atlas", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load {MODULE_PATH}")
ASSEMBLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ASSEMBLER)


class AssembleExtendedAtlasTest(unittest.TestCase):
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

if __name__ == "__main__":
    unittest.main()
