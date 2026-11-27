---
"@howaboua/pi-browser": patch
---

- On Linux, `start` uses the graphical desktop's configured default browser instead of falling back to Chromium. `CDP_BROWSER` still overrides browser selection.
