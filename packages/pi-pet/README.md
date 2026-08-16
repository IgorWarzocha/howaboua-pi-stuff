# Pi Pet

Pi Pet turns [GipPity Control](../pi-gippity-control) into an animated companion. Its bundled Clawa miniapp receives Pi activity, prompts, final replies, and realtime voice through GipPity Remote's existing browser SDK; Pi Pet contributes only pet rendering, reactions, assets, and an optional transparent Electron shell.

![Clawa running in the Pi Pet display.](docs/pi-pet.png)

## Install

```bash
pi install npm:@howaboua/pi-gippity-control
pi install npm:@howaboua/pi-pet
```

Run `/gippity server` or its configured shortcut. With Pi Pet loaded, GipPity serves Clawa at `/_gippity/apps/pi-pet/` on every announced server URL. GipPity's bundled or explicitly configured main remote UI remains at `/`.

Open `<gippity-url>/_gippity/apps/pi-pet/` and accept GipPity's local certificate. The same Clawa app provides:

- working, waiting, failure, and settled animation from Pi events;
- synchronized text prompts through `GippityRemote.send()`;
- realtime conversation through `GippityRemote.audio`;
- bounded final-reply bubbles;
- local action previews and sixteen pointer-look directions.

`pet_show` is the only model tool. It triggers an intentional named reaction; routine activity animates automatically and GipPity already owns speech and final text.

## Transparent desktop pet

The Electron shell loads the same GipPity-hosted app in a transparent, frameless, always-on-top window. It adds local cursor tracking, size, quiet mode, snooze, and login-startup policy without another agent runtime or remote protocol.

Build a bundle for the current platform:

```bash
bun --cwd=packages/pi-pet run desktop:package
```

Create `~/.config/pi-pet-desktop/config.json` with private permissions on Unix:

```json
{
  "schemaVersion": 1,
  "gippityUrl": "https://192.168.0.113:43120"
}
```

Run `runtime/electron app` from the generated release directory. Electron accepts GipPity's self-signed certificate only for that configured origin. Linux users may adapt the templates under `deploy/`; macOS and Windows should use their normal signed application packaging and startup mechanisms.

## Pet authoring

The bundled Clawa package follows the Codex-v2 atlas format and is validated while Pi Pet builds. Load `hatch-pi-pet` to create or repair a complete character with deterministic atlas assembly and independent visual review. Load `pi-pet` for existing actions or one additional data-only animation.

```bash
bun --cwd=packages/pi-pet run build
```

Refresh the GipPity display after rebuilding assets. Pet packages remain inert JSON and bounded PNG/WebP files; they cannot supply scripts, HTML, URLs, or commands.

See [`docs/architecture.md`](docs/architecture.md), [`SECURITY.md`](SECURITY.md), and [`docs/research.md`](docs/research.md).
