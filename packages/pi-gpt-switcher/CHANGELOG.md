# @howaboua/pi-gpt-switcher

## 0.1.3

- GPT-6 Sol and Luna now share Astra's Codex support.

  - Removed `/terra`; use `/luna` instead.
  - Added Responses Lite, non-destructive reasoning changes and terse context guidance for GPT-6 Sol and Luna.
  - Image descriptions now use GPT-6 Luna directly instead of preferring older mini models.
  - Cost estimates now use published GPT-6 Sol and Luna rates, including cache writes and long-context pricing.
  - Agent, review, exploration, web search, voice summary and image-description defaults now use GPT-6; Luna replaces Terra defaults. GPT Switcher retains Luna's 472K context limit, while Codex Conversion defaults all three GPT-6 models to 272K.

## 0.1.2

- Add /astra for GPT-6 Astra with low reasoning by default and an optional reasoning override.

## 0.1.1

### Changes

- [#333](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/333) [`a9143cf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a9143cfeb802406c2e62b4424e27b69da141b7ae) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add configurable session context windows and reasoning defaults for GPT shortcuts.

## 0.1.0

### Changes

- [#164](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/164) [`b8731f6`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b8731f68c8b6cbfb167e29728aad07fb59e560bb) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add `/sol`, `/terra`, and `/luna` commands for switching GPT-5.6 Codex models and reasoning levels.
