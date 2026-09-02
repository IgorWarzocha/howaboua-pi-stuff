# pi-codex-web-run

Codex web search, page opening, link traversal, and in-page finding for ordinary Pi, Code Mode, and Notebook Mode.

## Install

    pi install npm:@howaboua/pi-codex-web-run

Requires Pi 0.84.4 or newer and Node.js 22.19 or newer.

Run `/login openai-codex` for the normal Codex route. When the active model uses a compatible Codex transport, the tool can use it directly. Pi Codex can instead route an explicitly configured Responses provider with that provider's own credentials.

Pi Codex 3.0.24 or newer is optional. With it installed, the normal web_run tool becomes tools.web__run inside Code and Notebook Mode.

## Use

Use explicit search and navigation operations. Returned ref_ids belong to that search result and can be passed to open, click, or find. Cite the returned source URLs rather than internal ref_ids.

The Codex route uses GPT-5.6 Luna by default. Set `PI_CODEX_MODEL` to override it. Configured Responses routes keep their active configured model.
