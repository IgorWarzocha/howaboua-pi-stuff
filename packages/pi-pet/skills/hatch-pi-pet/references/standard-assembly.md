# Standard assembly

After all nine standard strips pass incremental checks:

```bash
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/extract_strip_frames.py" \
  --decoded-dir "$RUN_DIR/decoded" --output-dir "$RUN_DIR/frames" --states all --method auto
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/inspect_frames.py" \
  --frames-root "$RUN_DIR/frames" --json-out "$RUN_DIR/qa/review.json" --require-components
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/compose_atlas.py" \
  --frames-root "$RUN_DIR/frames" --output "$RUN_DIR/final/spritesheet.png" \
  --webp-output "$RUN_DIR/final/spritesheet.webp"
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/make_contact_sheet.py" \
  "$RUN_DIR/final/spritesheet.webp" --output "$RUN_DIR/qa/contact-sheet.png"
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/render_animation_previews.py" \
  --frames-root "$RUN_DIR/frames" --output-dir "$RUN_DIR/qa/previews"
```

Inspect `qa/contact-sheet.png` and every GIF at actual pet scale. Reject identity/style drift, blank or clipped poses, copied guides, wrong state semantics, reversed or static gait, inert idle, baseline jumps, and size popping.

If `auto` extraction alone causes popping while the source strip has stable scale and placement, rerun extraction with `--method stable-slots`, then inspection with `--allow-stable-slots`, composition, contact sheet, and previews. Record the decision. Never use stable slots to hide a broken source strip.
