# Acceptance rubric

Do not package until every required item passes.

## Geometry and data

- Final atlas exactly `1536×2288`, 8×11 grid, `192×208` cells.
- `spriteVersionNumber: 2`; used cells visible; unused standard cells transparent.
- Fully transparent pixels have zero RGB residue.
- Final despill report and v2 validation have `ok: true`; frame review has no errors.
- Package contains inert bounded files only and passes `pi-pet validate`.

## Identity and motion

- Same silhouette, proportions, face, expression language, material, palette, markings, lighting, and props across all rows.
- Every standard row has exact frame count and recognizable semantics.
- Idle is calm but not static; gait alternates; loops do not pop or reverse.
- Waiting, working, review, and failure remain visually distinct.
- No unintended character, object, logo, text, scene, shadow, detached effect, guide, or background.

## Directions

- Four approved cardinals and all sixteen directions in fixed clockwise order.
- Coherent adjacent movement, stable baseline/scale/anchor, no whole-sprite rotation or replacement eyes.
- Focused direction sheet, blind consensus, labeled semantics, and continuity evidence exist.
- Cardinal blind gates pass. No labeled wrong quadrant, reversal, clipping, identity drift, or unexplained visible continuity defect remains.
- Any warning has explicit evidence and reviewer/user disposition; no `fail` remains.

## Review and evidence

- Three isolated blind reviews plus independent final visual QA, or an explicitly recorded user-review fallback with reduced assurance.
- Repairs were independently re-reviewed.
- Retain request, final atlas, validation, despill, contact sheets, previews, direction sheets, blind verdicts/validation, semantics, continuity, final review, and run summary.
- `PET.md` records identity, action semantics, generation provenance, review method, and licensing uncertainty.
