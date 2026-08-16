# Reviewer protocol

## Isolation

- Use three fresh vision-capable reviewers for blind direction classification.
- Give each only `qa/direction-blind-pairs.png`; never provide labels, prompts, atlas order, answer key, prior verdicts, or another review.
- Use a separate final visual reviewer after deterministic processing and blind consensus.
- Reviewers inspect and report; the parent owns repairs, files, packaging, and cleanup.

## Blind direction review

Prompt each reviewer:

```text
Inspect only the supplied unlabeled A/B direction sheet.

Each row names one axis. For a horizontal row, classify A and B as screen-left, screen-right, or ambiguous. For a vertical row, classify A and B as up, down, or ambiguous. Judge at displayed pet size from pupils, nose, face/head turn, body aim, or the pet's natural aiming feature. Never infer from A/B order and do not force opposite answers.

Return exactly one JSON object:
{"pairs":[{"pair":"horizontal-1|vertical-1","A":"screen-left|screen-right|up|down|ambiguous","B":"screen-left|screen-right|up|down|ambiguous","reason":"short landmark evidence"}]}
Include every pair shown.
```

Write responses separately as `direction-blind-verdicts-{1,2,3}.json`, combine by strict majority, then validate against the hidden key. Cardinal ambiguity or mismatch blocks packaging. Intermediate disagreement becomes labeled-review evidence.

## Final visual review

Give the final reviewer:

- standard and extended contact sheets;
- all standard-row GIF previews;
- focused direction sheet;
- direction semantics, blind validation, and continuity JSON;
- frame review and v2 atlas validation.

Require exactly one JSON object and save it as `qa/final-visual-review.json`:

```json
{
  "visual_qa": "pass",
  "qa_note": "One-sentence evidence summary.",
  "reviewed_by": "agent:<identity>",
  "directions": [
    {
      "direction": "000",
      "expected": "up",
      "verdict": "pass",
      "horizontal": "neutral",
      "vertical": "up",
      "observed": "Visible landmark observation.",
      "reason": "Why the evidence passes, warns, or fails."
    }
  ],
  "warnings": [],
  "repair_rows": [],
  "repair_notes": []
}
```

Require all sixteen directions in `directions`. Copy that array with `overall`, `reviewed_by`, and warnings to `qa/direction-semantics.json`; do not reduce it to prose.

The reviewer checks one identity/style across all rows, correct state semantics, complete motion, transparency, no clipping/overlap/guides/detached effects, stable scale/baseline, and a coherent clockwise look loop. Deterministic despill and atlas validation are authoritative for chroma; visual review must not invent another cleanup pass.

## Failure resolution

- **Major:** wrong/ambiguous cardinal, labeled wrong quadrant/reversal, visible snap or scale pop, identity change, broken attachment, clipping, seam/hole, or deterministic failure. Repair required.
- **Minor:** subtle intermediate cue, reviewer disagreement, or metric warning without a visible defect. Parent or user may accept only with written labeled-loop evidence in `qa/blind-review-resolution.json`.
- Never override a major failure or let the repairing agent self-approve its repair.

## Run summary

After acceptance, write `qa/run-summary.json` with `ok: true`, `spriteVersionNumber: 2`, review method, package path, and paths to the final atlas, validation, despill, both contact sheets, previews, direction sheet, semantics, blind validation, continuity, and final visual review. A missing artifact is a failed summary, not `null` evidence.
