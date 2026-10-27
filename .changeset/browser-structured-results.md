---
"@howaboua/pi-browser": patch
---

- **BREAKING CHANGE:** Code and Notebook browser calls now return objects instead of JSON strings. Remove `JSON.parse` around browser results in saved code and helpers.
- Removed redundant conversion instructions from browser help.
