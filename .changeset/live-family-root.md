---
"@howaboua/pi-shepherdr": patch
---

Agent targets accept `/root` for the live root of their own family, including across connected machines. Missing or ambiguous roots fail explicitly; exact spawn/find targets remain unchanged.
