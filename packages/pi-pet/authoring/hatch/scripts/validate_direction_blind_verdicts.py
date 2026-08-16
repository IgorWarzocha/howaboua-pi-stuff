#!/usr/bin/env python3
"""Compare blind A/B direction classifications with the hidden answer key."""

# Modified from the Apache-2.0 Hatch Pet workflow for the Pi Pet authoring package.

from __future__ import annotations

import argparse
import json
from pathlib import Path

ALLOWED_DIRECTIONS = {"screen-left", "screen-right", "up", "down", "ambiguous"}


def load_json(path: str) -> dict[str, object]:
    return json.loads(Path(path).expanduser().resolve().read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--answer-key", required=True)
    parser.add_argument("--verdicts", required=True)
    parser.add_argument("--json-out", required=True)
    args = parser.parse_args()

    answer_key = load_json(args.answer_key)
    verdicts = load_json(args.verdicts)
    expected_by_pair = {entry["pair"]: entry for entry in answer_key.get("pairs", [])}
    verdict_by_pair = {entry["pair"]: entry for entry in verdicts.get("pairs", [])}
    errors: list[str] = []
    warnings: list[str] = []
    unconfirmed: list[str] = []
    results: list[dict[str, object]] = []

    for pair_id, expected in expected_by_pair.items():
        verdict = verdict_by_pair.get(pair_id)
        if verdict is None:
            errors.append(f"missing blind verdict for {pair_id}")
            continue
        axis = expected.get("axis", "horizontal")
        gate = expected.get("gate", "hard")
        if gate not in {"hard", "review"}:
            errors.append(f"{pair_id} has invalid gate: {gate!r}")
            gate = "hard"
        result: dict[str, object] = {"pair": pair_id, "axis": axis, "gate": gate}
        for slot in ("A", "B"):
            observed = verdict.get(slot)
            expected_direction = expected[slot].get(
                "expected_direction",
                expected[slot].get("expected_horizontal"),
            )
            if observed not in ALLOWED_DIRECTIONS:
                errors.append(f"{pair_id} {slot} has invalid classification: {observed!r}")
            elif observed == "ambiguous":
                message = f"{pair_id} {slot} {axis} axis is ambiguous"
                warnings.append(message)
                if gate == "hard":
                    unconfirmed.append(message)
            elif observed != expected_direction:
                message = f"{pair_id} {slot} classified {observed}; expected {expected_direction}"
                if gate == "hard":
                    errors.append(message)
                else:
                    warnings.append(message)
            result[slot] = {
                "observed": observed,
                "expected": expected_direction,
                "source_direction": expected[slot]["source_direction"],
                "pass": observed == expected_direction,
            }
        if verdict.get("A") == verdict.get("B") and verdict.get("A") != "ambiguous":
            message = f"{pair_id} A and B were classified as the same {axis} direction"
            if gate == "hard":
                errors.append(message)
            else:
                warnings.append(message)
        results.append(result)

    extra_pairs = sorted(set(verdict_by_pair) - set(expected_by_pair))
    if extra_pairs:
        errors.append(f"unexpected blind verdict pairs: {', '.join(extra_pairs)}")

    output = {
        "ok": not errors and not unconfirmed,
        "errors": errors,
        "warnings": warnings,
        "unconfirmed": unconfirmed,
        "reviewRequired": bool(warnings),
        "pairs": results,
    }
    output_path = Path(args.json_out).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2))
    if errors or unconfirmed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
