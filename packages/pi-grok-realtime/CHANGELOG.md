# @howaboua/pi-grok-realtime

## 0.0.4

- Updated package dependencies.
## 0.0.3

- Added `/grok server connect` to start voice in a local or configured remote browser and report whether it is listening.
- Added `/grok server status` and `ensure` to inspect or start the LAN listener without toggling it.
- Fixed restarting a transferred call returning to the original Pi session.

## 0.0.2

- - Added `stay_quiet` so Grok can choose silence during pauses without losing later silence follow-ups. Follow-ups respect the configured interval, microphone mute and Pi's working state.
  - Omit generated timestamps from agent work updates.

## 0.0.1

- ### Features

  Added Grok realtime voice with the current Pi agent doing the work.
  - Local audio on Linux, macOS and Windows, plus trusted-LAN browser control with live Pi activity.
  - Local and browser streaming dictation into an editable draft, with automatic language detection or an explicit language selection, without automatically sending requests.
  - Selectable voices, models and audio devices, custom Markdown instructions and conversation continuity summaries.
  - Session voice transfers through Shepherdr, retaining the original microphone and speakers. Each transfer alternates between configurable primary and alternate voices and greets the user in the destination's context.
  - Automatic connection recovery, saved transcripts and coordination with other active voice providers.
  - Custom voice tools and optional xAI web search.

  Uses the matching OAuth or API-key credential configured in Pi. Voice quota and billing depend on the account.
