---
"@howaboua/pi-reactions": patch
---

Added a clickable reaction picker below finished Pi replies. The default reactions are OK, Reconsider, Push and Verify. Reactions reach the agent on the next ordinary prompt without changing the prompt text.

Define reactions in `reactions.json`. A reaction with `"startTurn": true` starts its own turn when clicked.
