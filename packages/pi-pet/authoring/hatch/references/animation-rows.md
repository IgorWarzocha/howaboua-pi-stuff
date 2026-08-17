# Animation rows

| Row | Action | Used columns | Durations (ms) |
|---:|---|---:|---|
| 0 | idle | 0–5 | 280, 110, 110, 140, 140, 320 |
| 1 | running-right | 0–7 | 120 × 7, 220 |
| 2 | running-left | 0–7 | 120 × 7, 220 |
| 3 | waving | 0–3 | 140 × 3, 280 |
| 4 | jumping | 0–4 | 140 × 4, 280 |
| 5 | failed | 0–7 | 140 × 7, 240 |
| 6 | waiting | 0–5 | 150 × 5, 260 |
| 7 | running | 0–5 | 120 × 5, 220 |
| 8 | review | 0–5 | 150 × 5, 280 |
| 9 | look A | 0–7 | 000, 022.5, 045, 067.5, 090, 112.5, 135, 157.5° |
| 10 | look B | 0–7 | 180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5° |

`000°` means up. Neutral/front is the pointer deadzone and falls back to idle.

## Semantics

- `idle`: calm breathing/blinking; first frame also works as reduced-motion still.
- `running-right` / `running-left`: lateral locomotion with alternating cadence and correct facing.
- `waving`: greeting with clear gesture and return.
- `jumping`: anticipation, lift, peak, descent, settle.
- `failed`: readable blocked/deflated response without detached decoration.
- `waiting`: expectant request for user input, distinct from idle and review.
- `running`: active task work or processing, not literal locomotion.
- `review`: focused inspection of ready output.
- look rows: one continuous clockwise family using pet-specific eyes, head, body, appendages, and props.
