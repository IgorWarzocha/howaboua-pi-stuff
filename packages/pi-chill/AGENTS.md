Customize Chill for the user's conversation, tools and terminal. Folding choices, visible exceptions, wording and styling are defaults you may change, not fixed policy.

- Keep this source-only package private, without release changesets or aggregate membership, unless publication is explicitly requested.
- Choose the user's folding policy first. `index.ts` owns Markdown visibility, tool pass-through and renderer registration; `src/AGENTS.md` covers summaries, details and timeline changes. `new_context` and notes-saved notices are current visible exceptions, not universal rules.
- A tool pass-through change needs renderer selection, live execution handlers and restored membership to agree. Otherwise a hidden duplicate or empty disclosure can survive the visual change.
- Pi uses first-registered message/entry renderers. Choosing to fold another extension's notices affects load order and ownership; do not assume the tool renderer's `next()` chain exists for those notices.
- Use public Pi rendering hooks only. Keep non-interactive output native, and keep `/chill` reversible for already-rendered history as well as future events.
- Keep customization presentation-only. Do not patch Codex Conversion internals, mutate model messages or persisted history, or add prompt instructions to obtain a layout effect.
- Validate the changed seam with real native components at narrow and wide widths. For visibility or lifecycle changes, include live and restored sessions, expanded details and `/chill` off; do not turn a cosmetic change into a broad integration tour.
