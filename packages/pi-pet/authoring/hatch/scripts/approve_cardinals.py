#!/usr/bin/env python3
"""Complete the cardinal approval gate only when its required evidence exists."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

MAX_MANIFEST_BYTES = 1024 * 1024
MAX_EVIDENCE_BYTES = 1024 * 1024
EXPECTED_STRIP_SIZE = (4 * 192, 208)


def load_object(path: Path, limit: int) -> dict[str, object]:
    if not path.is_file() or path.stat().st_size > limit:
        raise SystemExit(f"missing or oversized evidence: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SystemExit(f"invalid JSON evidence: {path}: {error}") from error
    if not isinstance(value, dict):
        raise SystemExit(f"JSON evidence must be an object: {path}")
    return value


def job(manifest: dict[str, object], job_id: str) -> dict[str, object]:
    jobs = manifest.get("jobs")
    if not isinstance(jobs, list):
        raise SystemExit("visual-jobs.json jobs must be a list")
    for value in jobs:
        if isinstance(value, dict) and value.get("id") == job_id:
            return value
    raise SystemExit(f"visual-jobs.json is missing job: {job_id}")


def run_file(run_dir: Path, relative: str) -> Path:
    if not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise SystemExit(f"approval artifact path is unsafe: {relative!r}")
    path = (run_dir / relative).resolve()
    try:
        path.relative_to(run_dir)
    except ValueError as error:
        raise SystemExit(f"approval artifact escapes run directory: {relative}") from error
    return path


def atomic_write(path: Path, value: dict[str, object]) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--reviewed-by", required=True)
    parser.add_argument("--qa-note", required=True)
    args = parser.parse_args()

    reviewed_by = args.reviewed_by.strip()
    qa_note = args.qa_note.strip()
    if not reviewed_by or len(reviewed_by) > 80:
        raise SystemExit("--reviewed-by must contain 1-80 characters")
    if not qa_note or len(qa_note) > 500:
        raise SystemExit("--qa-note must contain 1-500 characters")

    run_dir = Path(args.run_dir).expanduser().resolve()
    manifest_path = run_dir / "visual-jobs.json"
    manifest = load_object(manifest_path, MAX_MANIFEST_BYTES)
    source_job = job(manifest, "look-cardinals")
    gate = job(manifest, "look-cardinals-approved")
    if source_job.get("status") != "complete":
        raise SystemExit("look-cardinals generation must be complete before approval")

    required = gate.get("required_artifacts")
    if not isinstance(required, list) or not all(isinstance(value, str) for value in required):
        raise SystemExit("cardinal approval gate has invalid required_artifacts")
    artifacts = {relative: run_file(run_dir, relative) for relative in required}
    for relative, path in artifacts.items():
        if not path.is_file() or path.stat().st_size <= 0 or path.stat().st_size > MAX_EVIDENCE_BYTES:
            raise SystemExit(f"missing or oversized cardinal approval artifact: {relative}")

    report = load_object(run_dir / "qa/cardinal-anchors.json", MAX_EVIDENCE_BYTES)
    if report.get("ok") is not True:
        raise SystemExit("cardinal anchor extraction did not pass")
    with Image.open(run_dir / "decoded/look-anchors-approved.png") as image:
        if image.size != EXPECTED_STRIP_SIZE:
            raise SystemExit(
                f"approved cardinal strip must be {EXPECTED_STRIP_SIZE[0]}x{EXPECTED_STRIP_SIZE[1]}"
            )
        image.verify()

    gate["status"] = "complete"
    gate["completed_at"] = datetime.now(timezone.utc).isoformat()
    gate["reviewed_by"] = reviewed_by
    gate["qa_note"] = qa_note
    atomic_write(manifest_path, manifest)
    print(json.dumps({"ok": True, "job_id": "look-cardinals-approved"}))


if __name__ == "__main__":
    main()
