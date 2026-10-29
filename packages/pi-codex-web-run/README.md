# pi-codex-web-run

Codex web search, page opening, link traversal, and in-page finding for ordinary Pi, Code Mode, and Notebook Mode.

## Install

    pi install npm:@howaboua/pi-codex-web-run

Requires Pi 1.0.0 or newer and Node.js 22.19 or newer.

Run `/login openai-codex` for the normal Codex route, including when chatting with another provider. Compatible active Codex transports keep their own credentials. Pi Codex's resolver is preferred when present, but its conversation-provider scope does not select tool endpoints. Neither Pi Codex nor an install script is required.

Pi Codex 3.0.25 or newer is optional. With it installed, the normal web_run tool becomes tools.web__run inside Code and Notebook Mode.

## Use

Use explicit search and navigation operations. Returned ref_ids belong to that search result and can be passed to open, click, or find. Cite the returned source URLs rather than internal ref_ids.

The Codex route uses GPT-6 Luna by default. Set `PI_CODEX_MODEL` to override it. Configured Responses routes keep their active configured model.

For a proxy that renames Codex providers or models, create `pi-codex-tools.json` in Pi's agent directory:

```json
{
	"providers": {
		"company-codex": {
			"gpt-6-luna": "company-luna"
		}
	}
}
```

Each provider key identifies a Codex endpoint route. Its object maps the tool's canonical model names to that provider's aliases. Use an empty object when the provider renames no models.

## Extension API

Other extensions can discover optional search and navigation through Pi's event bus on each call:

```ts
let service: CodexWebRunService | undefined;
pi.events.emit("@howaboua/pi-codex-web-run.service/v1", {
	use(candidate: CodexWebRunService) {
		service = candidate;
	},
});
if (!service)
	throw new Error("Web search is unavailable. Install pi-codex-web-run.");
const result = await service.run(
	ctx,
	{ search_query: [{ q: "Pi extensions" }] },
	signal,
);
```

`CodexWebRunService` is a type export from this package. Discovery is synchronous and works in either extension load order after initialisation. It does not check account access or start a request.

`run` accepts the existing `web_run` arguments, including `open`, `click` and `find`. It returns `{ text, details }` with the same source URLs and reusable result references as the tool. It uses the tool's configured provider and existing login without switching accounts. Errors reject the promise. Pass an `AbortSignal` to cancel work. Session shutdown cancels outstanding requests and invalidates retained service handles.

Results go only to the caller. The API does not add messages to Pi's conversation or change the model's tools.
