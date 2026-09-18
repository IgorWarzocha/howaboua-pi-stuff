---
"@howaboua/pi-shepherdr": patch
---

Fixed agent answers being refused when prompt or footer text contains "Review". Shepherdr now reads the complete outer Ask panel, including nested text editors, and refuses incomplete captures without sending input.
