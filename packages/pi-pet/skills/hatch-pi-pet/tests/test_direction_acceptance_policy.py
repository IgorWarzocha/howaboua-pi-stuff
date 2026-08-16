import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

SKILL_DIR = Path(__file__).resolve().parents[1]
VALIDATE_BLIND = SKILL_DIR / "scripts" / "validate_direction_blind_verdicts.py"
MEASURE_CONTINUITY = SKILL_DIR / "scripts" / "measure_direction_continuity.py"
MAKE_BLIND_SHEET = SKILL_DIR / "scripts" / "make_direction_blind_qa_sheet.py"


class DirectionAcceptancePolicyTest(unittest.TestCase):
    def run_blind_validation(
        self,
        temporary_directory: str,
        *,
        gate: str | None,
        verdict_a: str,
        verdict_b: str,
    ) -> tuple[subprocess.CompletedProcess[str], dict[str, object]]:
        root = Path(temporary_directory)
        answer_key = root / "answer-key.json"
        verdicts = root / "verdicts.json"
        output = root / "validation.json"
        pair = {
            "pair": "pair-1",
            "axis": "horizontal",
            "A": {
                "expected_direction": "screen-right",
                "source_direction": "022.5",
            },
            "B": {
                "expected_direction": "screen-left",
                "source_direction": "337.5",
            },
        }
        if gate is not None:
            pair["gate"] = gate
        answer_key.write_text(json.dumps({"pairs": [pair]}))
        verdicts.write_text(
            json.dumps(
                {
                    "pairs": [
                        {
                            "pair": "pair-1",
                            "A": verdict_a,
                            "B": verdict_b,
                            "reason": "test",
                        }
                    ]
                }
            )
        )
        completed = subprocess.run(
            [
                sys.executable,
                str(VALIDATE_BLIND),
                "--answer-key",
                str(answer_key),
                "--verdicts",
                str(verdicts),
                "--json-out",
                str(output),
            ],
            capture_output=True,
            text=True,
        )
        return completed, json.loads(output.read_text())

    def test_review_pair_ambiguity_requests_review_without_failing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            completed, result = self.run_blind_validation(
                temporary_directory,
                gate="review",
                verdict_a="ambiguous",
                verdict_b="ambiguous",
            )

        self.assertEqual(completed.returncode, 0)
        self.assertTrue(result["ok"])
        self.assertTrue(result["reviewRequired"])
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["unconfirmed"], [])
        self.assertGreater(len(result["warnings"]), 0)

    def test_clear_horizontal_ambiguity_is_also_unconfirmed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            completed, result = self.run_blind_validation(
                temporary_directory,
                gate="hard",
                verdict_a="ambiguous",
                verdict_b="ambiguous",
            )

        self.assertEqual(completed.returncode, 1)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errors"], [])
        self.assertGreater(len(result["unconfirmed"]), 0)
        self.assertGreater(len(result["warnings"]), 0)

    def test_explicit_wrong_direction_remains_a_hard_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            completed, result = self.run_blind_validation(
                temporary_directory,
                gate="hard",
                verdict_a="screen-left",
                verdict_b="screen-left",
            )

        self.assertEqual(completed.returncode, 1)
        self.assertFalse(result["ok"])
        self.assertGreater(len(result["errors"]), 0)

    def test_review_pair_wrong_direction_requests_review_without_failing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            completed, result = self.run_blind_validation(
                temporary_directory,
                gate="review",
                verdict_a="screen-left",
                verdict_b="screen-left",
            )

        self.assertEqual(completed.returncode, 0)
        self.assertTrue(result["ok"])
        self.assertEqual(result["errors"], [])
        self.assertGreater(len(result["warnings"]), 0)

    def test_missing_gate_preserves_strict_compatibility(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            completed, result = self.run_blind_validation(
                temporary_directory,
                gate=None,
                verdict_a="ambiguous",
                verdict_b="ambiguous",
            )

        self.assertEqual(completed.returncode, 1)
        self.assertFalse(result["ok"])
        self.assertTrue(result["reviewRequired"])

    def test_continuity_outlier_requests_review_without_failing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            atlas_path = root / "atlas.png"
            output = root / "continuity.json"
            atlas = Image.new("RGBA", (1536, 2288), (0, 0, 0, 0))
            draw = ImageDraw.Draw(atlas)
            for index in range(16):
                row = 9 + index // 8
                column = index % 8
                size = 120 if index == 4 else 50
                left = column * 192 + 20
                top = row * 208 + 20
                draw.rectangle((left, top, left + size, top + size), fill=(0, 0, 0, 255))
            atlas.save(atlas_path)

            completed = subprocess.run(
                [
                    sys.executable,
                    str(MEASURE_CONTINUITY),
                    str(atlas_path),
                    "--json-out",
                    str(output),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            result = json.loads(output.read_text())

        self.assertEqual(completed.returncode, 0)
        self.assertTrue(result["ok"])
        self.assertTrue(result["reviewRequired"])
        self.assertGreater(len(result["warnings"]), 0)

    def test_blind_sheet_uses_two_normal_size_cells_without_zoom_crops(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            atlas_path = root / "atlas.png"
            sheet_path = root / "blind.png"
            answer_key = root / "answer-key.json"
            Image.new("RGBA", (1536, 2288), (0, 0, 0, 0)).save(atlas_path)

            subprocess.run(
                [
                    sys.executable,
                    str(MAKE_BLIND_SHEET),
                    str(atlas_path),
                    "--output",
                    str(sheet_path),
                    "--answer-key",
                    str(answer_key),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            with Image.open(sheet_path) as sheet:
                self.assertEqual(sheet.width, 2 * 192)

            pairs = json.loads(answer_key.read_text())["pairs"]

        self.assertEqual(len(pairs), 14)
        self.assertEqual([pair["axis"] for pair in pairs].count("horizontal"), 7)
        self.assertEqual([pair["axis"] for pair in pairs].count("vertical"), 7)
        self.assertEqual([pair["gate"] for pair in pairs].count("hard"), 2)
        self.assertEqual([pair["gate"] for pair in pairs].count("review"), 12)


if __name__ == "__main__":
    unittest.main()
