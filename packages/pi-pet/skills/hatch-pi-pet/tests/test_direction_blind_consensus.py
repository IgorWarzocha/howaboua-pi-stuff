import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]
COMBINE = SKILL_DIR / "scripts" / "combine_direction_blind_verdicts.py"


class DirectionBlindConsensusTest(unittest.TestCase):
    def test_strict_majority_wins_and_tie_becomes_ambiguous(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            reviews = [
                {"A": "screen-left", "B": "up"},
                {"A": "screen-left", "B": "down"},
                {"A": "screen-right", "B": "ambiguous"},
            ]
            paths = []
            for index, review in enumerate(reviews):
                path = root / f"review-{index}.json"
                path.write_text(json.dumps({"pairs": [{"pair": "pair-1", **review}]}))
                paths.append(path)
            output = root / "combined.json"

            subprocess.run(
                [
                    sys.executable,
                    str(COMBINE),
                    *[argument for path in paths for argument in ("--verdicts", str(path))],
                    "--json-out",
                    str(output),
                ],
                check=True,
            )
            pair = json.loads(output.read_text())["pairs"][0]

        self.assertEqual(pair["A"], "screen-left")
        self.assertEqual(pair["B"], "ambiguous")


if __name__ == "__main__":
    unittest.main()
