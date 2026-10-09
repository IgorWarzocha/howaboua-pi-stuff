---
"@howaboua/pi-shepherdr": patch
---

Reduced redundant monitoring warnings. Closing or unwatching workers retires their question watches and suppresses late collection failures. Subscription updates handle closed or moved panes without spurious failure and recovery notices. Repeated board-owner outage warnings are coalesced until connectivity recovers. Monitoring failures retain Herdr's event-stream error details locally and over SSH.
