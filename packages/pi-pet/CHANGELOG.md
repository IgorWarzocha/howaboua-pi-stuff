# @howaboua/pi-pet

## 0.1.7

- Added empty-call reaction discovery, including when no pet is connected, and deferred Code and Notebook help.

## 0.1.6

- Desktop attachment now uses Electron 44 and requires macOS 13 or newer, or a supported 64-bit Windows or Linux desktop. Linux ARMv7, 32-bit Windows and Linux Unity are no longer supported. The browser miniapp is unchanged.

## 0.1.5

- Pi Pet desktop now requires Node 22.12 or newer.

## 0.1.4

- Remove obsolete test-only helper exports without changing tool behavior.

## 0.1.3

- Expose Pi Pet's extension from the package root so aggregate extension packages can load it.

## 0.1.2

- Fixed waiting indicators for extension UI prompts.

## 0.1.1

### Changes

- [#304](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/304) [`4b4e42f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4b4e42f7659e42854ec81cb502bf69a48422d9eb) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Run Pi Pet as a first-class GipPity companion.
  - Meet Clawa through the browser, voice, desktop dictation, a transparent desktop window, or the headless pet-state feed.
  - Import compatible Codex and ChatGPT pets or author new pets through free-form `/pet` requests.
  - Keep authored pets and generated displays in durable Pi agent storage, with optional per-repository pet selection.
  - Attach the local device directly or remote devices through Pi-owned SSH sessions, with each folder remembering where its sessions appear.
  - Get exact install and reload guidance when GipPity Control is missing or outdated.
