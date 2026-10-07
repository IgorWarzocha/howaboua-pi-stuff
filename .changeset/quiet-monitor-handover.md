---
"@howaboua/pi-shepherdr": patch
---

Fixed spurious monitor failure and recovery notices when subscription updates encounter closed or moved panes. Monitoring failures now retain Herdr's event-stream error details locally and over SSH.
