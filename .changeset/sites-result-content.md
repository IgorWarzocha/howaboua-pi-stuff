---
"@howaboua/pi-chatgpt-sites": patch
---

- Sites results omit redundant success wrappers. Saved code using the extension's outer `result` field should read the returned Sites payload directly.
- Errors show the problem and recovery information without diagnostic envelopes.
