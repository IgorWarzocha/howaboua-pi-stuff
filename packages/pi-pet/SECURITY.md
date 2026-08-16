# Security model

Pi Pet crosses two sensitive boundaries: agent-controlled display output and browser-authored prompts entering a live Pi session.

## Defaults

- The broker accepts only `127.0.0.1` and validates browser origins.
- Agent and display roles use distinct random bearer tokens.
- Browser tokens remain in session storage; the agent token never reaches the browser.
- Only the currently connected extension session can mutate state, reload pets, acknowledge prompts, or receive browser prompts.
- Prompt input is bounded, rate-limited, visibly prefixed with its display provenance, and queued as a follow-up while Pi is busy.
- Request bodies, manifest fields, asset files, decoded dimensions, frames, and text are bounded.
- Pet assets resolve through `realpath`; traversal and escaping symlinks fail.
- Manifests are strict inert JSON. Unknown fields fail and no pet content is evaluated.

## Trusted-LAN mode

`pi-pet network lan` is an explicit opt-in that binds the broker to all interfaces. It keeps the existing role-separated bearer tokens, same-origin browser checks, prompt bounds, and single-session ownership, but it does not add TLS or multi-user authorization. Use it only on a trusted LAN and scope any firewall rule to that subnet. `pi-pet network loopback` restores the default after a broker restart.

The Electron client keeps Chromium sandboxing and context isolation enabled, disables Node integration and permissions, rejects new windows, and permits navigation only within its configured broker origin. Its display credential is loaded from a bounded local config and passed in the URL fragment, not the query string.

## Not provided

The current protocol does not provide TLS, public-internet authentication, multi-user authorization, or safe routing among several simultaneous Pi sessions. Do not forward it through a public reverse proxy or share display credentials outside the trusted LAN/SSH path.

If a display credential is exposed, stop the service, replace `~/.config/pi-pet/config.json` with a newly generated config, and restart Pi plus the service. Do not post credentials in issue reports or logs.
