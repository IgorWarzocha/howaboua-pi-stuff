# @howaboua/pi-reactions

## 0.0.3

- Added optional per-reaction keyboard shortcuts for the latest finished reply. No keys are bound by default.

## 0.0.2

- Added a clickable reaction picker below finished Pi replies. The default reactions are OK, Reconsider, Push and Verify. Reactions reach the agent on the next ordinary prompt without changing the prompt text.

  Define reactions in `reactions.json`. A reaction with `"startTurn": true` starts its own turn when clicked.
