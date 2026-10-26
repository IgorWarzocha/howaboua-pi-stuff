---
"@howaboua/pi-browser": patch
---

- **BREAKING CHANGE:** Code and Notebook browser calls now return objects instead of JSON strings. Remove `JSON.parse` around browser results in saved code and helpers.
- Removed input and output conversion instructions from browser help. Existing input forms remain accepted.
