# Look-direction generation

## Mechanics plan

Write `qa/look-mechanics.md` before generation:

- natural gaze mechanism for this construction;
- stable anchor and baseline;
- eyes/eyelids/head/body parts that lead and follow;
- deformation allowed by material;
- prop attachment, occlusion, and lag;
- cardinal pose families and expected visible sides;
- roughly even motion budget for each 22.5° step.

Physical eyeballs rotate as complete globes with iris, pupil, eyelids, rim, and highlights. Printed/screen eyes may move features on a fixed surface. Flexible bodies bend; blobs stretch subtly; separate heads turn; rigid objects use an appropriate hinge, aim, lean, or attached feature. Preserve the original eye design—never add replacement or googly eyes.

## Cardinal gate

Generate `000 up`, `090 screen-right`, `180 down`, and `270 screen-left together. Viewer/screen coordinates are authoritative. At normal pet size, cardinals must be unmistakable from pupils, nose, face surface, head/body direction, or the pet's natural aiming feature. Regenerate an ambiguous anchor.

## Coherent rows

- Row 9: `000, 022.5, 045, 067.5, 090, 112.5, 135, 157.5`.
- Row 10: `180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5`.
- Generate each row as one eight-pose family, not eight unrelated cells.
- Keep scale, lower-body anchor, baseline, identity, and props continuous.
- Row 10 receives completed row 9; `157.5→180` and `337.5→000` are normal adjacent transitions.
- Every look pose differs visibly from neutral at actual display size.
- No whole-sprite rotation, skew, affine tilt, procedural pupil overlay, independent recentering, or patched final cell unless the pet's literal construction and mechanics plan justify it.

## Acceptance

Hard failure: wrong/ambiguous cardinal, labeled wrong quadrant, reversal, conspicuous snap, scale/registration pop, identity change, broken attachment, clipping, seam, transparent interior damage, or replacement eyes.

Review warning: subtle intermediate cue, similar neighbors, isolated blind uncertainty, or a metric outlier without a visible defect. Warnings require recorded labeled-loop judgment; they do not automatically force regeneration.
