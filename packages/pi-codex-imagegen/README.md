# pi-codex-imagegen

Codex image generation and editing for ordinary Pi, Code Mode, and Notebook Mode.

## Install

    pi install npm:@howaboua/pi-codex-imagegen

Run /login openai-codex first. When the active model uses a compatible Codex transport, the tool can use it directly. Pi Codex also lets explicitly configured Responses providers opt into the same route.

Pi Codex 3.0.24 or newer is optional. With it installed, the normal imagegen tool becomes tools.image_gen__imagegen inside Code and Notebook Mode.

## Use

Provide only a prompt to generate. For edits, provide up to five PNG, JPEG, GIF, or WebP paths, or select the smallest recent conversation-image count that covers the targets.

Images are saved beneath the workspace at .pi/openai-codex-images with a latest.png alias.
