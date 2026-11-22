---
name: pi-stuff-sandbox-review
description: "Read when preparing or reviewing an explicitly requested live Pi sandbox run."
---

Use the dedicated `sandbox-reviewer` profile for acceptance. A programmatic gap does not authorise a live review, and programmatic probes do not substitute for one.

- Stop active review agents before replacing the guest snapshot. Host edits do not update the guest.
- Prepare the candidate with `bun run sandbox:setup --name NAME --live-model openai-codex/MODEL`. Use its scoped access-token sync from the host Pi login. Fix guest readiness instead of moving acceptance to the host. See `docs/e2e-sandboxing-test-procedure/README.md` for setup and evidence.
- Exercise consecutive ordinary turns with tools and the guest environment through Pi's TUI in Herdr.
- For release acceptance, verify guest compatibility first and use the candidate's bundled native helpers without overrides. Replace incompatible disposable guests rather than rebuilding around them.
