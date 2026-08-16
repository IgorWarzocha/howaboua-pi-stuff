#!/usr/bin/env python3
"""Combine independent blind direction verdicts by strict per-cell majority."""

# Modified from the Apache-2.0 Hatch Pet workflow for the Pi Pet authoring package.

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


def load_pairs(path: str) -> dict[str, dict[str, object]]:
    payload = json.loads(Path(path).expanduser().resolve().read_text(encoding="utf-8"))
    return {entry["pair"]: entry for entry in payload.get("pairs", [])}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verdicts", action="append", required=True)
    parser.add_argument("--json-out", required=True)
    args = parser.parse_args()

    if len(args.verdicts) < 3 or len(args.verdicts) % 2 == 0:
        raise SystemExit("provide an odd number of at least three verdict files")

    reviews = [load_pairs(path) for path in args.verdicts]
    pair_ids = set(reviews[0])
    if any(set(review) != pair_ids for review in reviews[1:]):
        raise SystemExit("all verdict files must contain the same pair ids")

    threshold = len(reviews) // 2 + 1
    combined = []
    for pair_id in reviews[0]:
        result: dict[str, object] = {"pair": pair_id}
        vote_summary: dict[str, object] = {}
        for slot in ("A", "B"):
            votes = [review[pair_id].get(slot) for review in reviews]
            counts = Counter(votes)
            direction, count = counts.most_common(1)[0]
            result[slot] = direction if count >= threshold else "ambiguous"
            vote_summary[slot] = dict(counts)
        result["reason"] = "strict majority of independent blind reviews"
        result["votes"] = vote_summary
        combined.append(result)

    output = Path(args.json_out).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"pairs": combined}, indent=2) + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
