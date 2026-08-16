import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

SKILL_DIR = Path(__file__).resolve().parents[1]
PREPARE = SKILL_DIR / "scripts/prepare_pet_run.py"
DERIVE_LEFT = SKILL_DIR / "scripts/derive_running_left_from_running_right.py"
APPROVE_CARDINALS = SKILL_DIR / "scripts/approve_cardinals.py"
VALIDATE = SKILL_DIR / "scripts/validate_atlas.py"


class WorkflowBoundaryTest(unittest.TestCase):
    def prepare(self, root: Path) -> Path:
        run_dir = root / "run"
        subprocess.run(
            [
                sys.executable,
                str(PREPARE),
                "--pet-name",
                "Boundary",
                "--output-dir",
                str(run_dir),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return run_dir

    def test_cardinal_approval_is_an_explicit_dependency_gate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            run_dir = self.prepare(Path(temporary_directory))
            manifest = json.loads((run_dir / "visual-jobs.json").read_text())
            jobs = {job["id"]: job for job in manifest["jobs"]}

        self.assertEqual(jobs["look-cardinals-approved"]["kind"], "visual-approval-gate")
        self.assertIsNone(jobs["look-cardinals-approved"]["generation_capability"])
        self.assertEqual(jobs["look-row-9"]["depends_on"], ["look-cardinals-approved"])

    def test_cardinal_gate_requires_all_approved_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            run_dir = self.prepare(Path(temporary_directory))
            manifest_path = run_dir / "visual-jobs.json"
            manifest = json.loads(manifest_path.read_text())
            next(job for job in manifest["jobs"] if job["id"] == "look-cardinals")["status"] = "complete"
            manifest_path.write_text(json.dumps(manifest))
            completed = subprocess.run(
                [
                    sys.executable,
                    str(APPROVE_CARDINALS),
                    "--run-dir",
                    str(run_dir),
                    "--reviewed-by",
                    "reviewer",
                    "--qa-note",
                    "all cardinals read correctly",
                ],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("cardinal approval artifact", completed.stderr)

            (run_dir / "qa/look-mechanics.md").write_text("Eyes and head turn; feet remain anchored.\n")
            (run_dir / "qa/cardinal-anchors.json").write_text(json.dumps({"ok": True}))
            Image.new("RGBA", (4 * 192, 208), "white").save(run_dir / "decoded/look-anchors-approved.png")
            subprocess.run(
                [
                    sys.executable,
                    str(APPROVE_CARDINALS),
                    "--run-dir",
                    str(run_dir),
                    "--reviewed-by",
                    "reviewer",
                    "--qa-note",
                    "all cardinals read correctly",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            approved = next(
                job
                for job in json.loads(manifest_path.read_text())["jobs"]
                if job["id"] == "look-cardinals-approved"
            )

        self.assertEqual(approved["status"], "complete")
        self.assertEqual(approved["reviewed_by"], "reviewer")

    def test_running_left_derivation_stays_staged_with_output_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            run_dir = Path(temporary_directory)
            decoded = run_dir / "decoded"
            decoded.mkdir()
            Image.new("RGBA", (800, 100), "white").save(decoded / "running-right.png")
            manifest = {
                "jobs": [
                    {"id": "running-right", "status": "complete"},
                    {
                        "id": "running-left",
                        "status": "pending",
                        "mirror_policy": {"may_derive_from": "running-right"},
                    },
                ]
            }
            manifest_path = run_dir / "visual-jobs.json"
            manifest_path.write_text(json.dumps(manifest))
            subprocess.run(
                [
                    sys.executable,
                    str(DERIVE_LEFT),
                    "--run-dir",
                    str(run_dir),
                    "--confirm-appropriate-mirror",
                    "--decision-note",
                    "symmetric identity",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            left = json.loads(manifest_path.read_text())["jobs"][1]

        self.assertEqual(left["status"], "staged")
        self.assertEqual(left["source_path"], "decoded/running-left.png")
        self.assertEqual(left["derived_from_source"], "decoded/running-right.png")
        self.assertNotIn("completed_at", left)

    def test_prepare_rejects_oversized_reference_before_decoding(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            reference = root / "oversized.png"
            with reference.open("wb") as file:
                file.truncate(16 * 1024 * 1024 + 1)
            completed = subprocess.run(
                [
                    sys.executable,
                    str(PREPARE),
                    "--pet-name",
                    "Bounded",
                    "--reference",
                    str(reference),
                    "--output-dir",
                    str(root / "run"),
                ],
                capture_output=True,
                text=True,
            )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("reference must be", completed.stderr)

    def test_validator_reports_unsupported_rows_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            atlas = root / "twelve-rows.png"
            report = root / "report.json"
            Image.new("RGBA", (1536, 12 * 208), (0, 0, 0, 0)).save(atlas)
            completed = subprocess.run(
                [sys.executable, str(VALIDATE), str(atlas), "--json-out", str(report)],
                capture_output=True,
                text=True,
            )
            result = json.loads(report.read_text())

        self.assertEqual(completed.returncode, 1)
        self.assertFalse(result["ok"])
        self.assertNotIn("Traceback", completed.stderr)


if __name__ == "__main__":
    unittest.main()
