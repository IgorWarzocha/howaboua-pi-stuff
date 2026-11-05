# pi-codex-imagegen

Image generation and editing through Codex OAuth or the OpenAI API, for ordinary Pi, Code Mode, and Notebook Mode.

## Install

    pi install npm:@howaboua/pi-codex-imagegen

Requires Pi 1.5 or newer and Node.js 22.19 or newer.

Run `/login openai-codex` for the normal Codex route, including when chatting with another provider. Compatible active Codex transports keep their own credentials. Pi Codex's resolver is preferred when present, but its conversation-provider scope does not select tool endpoints. Neither Pi Codex nor an install script is required.

Pi Codex 4.0.7 or newer is optional. With it installed, the normal imagegen tool becomes tools.image_gen__imagegen inside Code and Notebook Mode.

## Access and preferences

Open `/imagegen` to choose access. Codex OAuth is the default and preserves compatible configured Codex routes. OpenAI API uses the `openai` credentials already configured in Pi and sends requests to `api.openai.com`. API billing is separate from your Codex subscription. Neither route falls back to the other.

For OpenAI API access, choose Flare or Sunburst and your default quality and complexity. Complexity controls planning effort, with High as the API default. These preferences are saved in Pi's agent directory without credentials. Codex access does not expose a Flare or Sunburst choice because its endpoint does not confirm which image model runs.

## Use

Provide only a prompt to generate. For edits, provide up to five local image paths, or select the smallest recent conversation-image count that covers the targets. Codex accepts PNG, JPEG, GIF and WebP inputs. OpenAI API accepts PNG, JPEG and WebP inputs.

The agent chooses the output format, size, transparency and animation timing for each request. OpenAI API supports PNG, JPEG and WebP generation and editing, plus native GIF and SVG generation. GIF and SVG edits are unsupported. Transparent output requires PNG or WebP. Codex keeps its existing PNG generation and editing behaviour; describe size and aspect ratio in the prompt there.

Images are saved beneath the workspace at `.pi/openai-codex-images` with a format-specific alias such as `latest.png` or `latest.gif`. GIF files retain their animation and provide a still preview to the model. SVG is saved as a file without an inline preview.

For a proxy that renames Codex providers or models, create `pi-codex-tools.json` in Pi's agent directory:

```json
{
	"providers": {
		"company-codex": {
			"gpt-image-2.5": "company-image"
		}
	}
}
```

Each provider key identifies a Codex endpoint route. Its object maps the tool's canonical model names to that provider's aliases. Use an empty object when the provider renames no models.
