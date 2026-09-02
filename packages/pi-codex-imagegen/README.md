# pi-codex-imagegen

Codex image generation and editing for ordinary Pi, Code Mode, and Notebook Mode.

## Install

    pi install npm:@howaboua/pi-codex-imagegen

Requires Pi 0.84.4 or newer and Node.js 22.19 or newer.

Run `/login openai-codex` for the normal Codex route. When the active model uses a compatible Codex transport, the tool can use it directly. Pi Codex can instead route an explicitly configured Responses provider with that provider's own credentials.

Pi Codex 3.0.24 or newer is optional. With it installed, the normal imagegen tool becomes tools.image_gen__imagegen inside Code and Notebook Mode.

## Use

Provide only a prompt to generate. For edits, provide up to five PNG, JPEG, GIF, or WebP paths, or select the smallest recent conversation-image count that covers the targets.

Images are saved beneath the workspace at .pi/openai-codex-images with a latest.png alias.

For a proxy that renames Codex providers or models, create `pi-codex-tools.json` in Pi's agent directory:

```json
{
  "providers": {
    "company-codex": {
      "gpt-image-2": "company-image"
    }
  }
}
```

Each provider key identifies a Codex endpoint route. Its object maps the tool's canonical model names to that provider's aliases. Use an empty object when the provider renames no models.
