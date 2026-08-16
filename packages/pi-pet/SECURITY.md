# Security model

Pi Pet adds no listener, credential store, prompt endpoint, or remote session ownership. GipPity Control owns those boundaries.

## Miniapp

- GipPity confines static files to Pi Pet's registered realpath and reserves its SDK/API routes.
- Browser prompts and voice use the hosted `GippityRemote` client rather than a pet-specific transport.
- Custom reaction state is normalized and bounded by GipPity before browser delivery.
- Pet manifests are strict inert JSON. Assets are bounded regular PNG/WebP files; traversal, escaping symlinks, excessive decoded size, and out-of-frame geometry fail during builds.
- Authored pets stay under the Pi agent directory and reach the generated web root only after validation. Package updates refresh executable web-shell files without overwriting user pet sources or run evidence. Invalid durable state reports a warning and falls back to bundled Clawa.

## Electron

- Attached displays are reached only through the user's existing SSH authentication and host configuration. Pi Pet passes a bounded Node bootstrap over SSH stdin; SSH targets cannot contain command options.
- The extension copies a fixed, bounded set of desktop source files from its own installed package into `~/.pi/agent/pi-pet` on the display. It records the package version and source digest only after a successful npm build, reuses matching builds, and leaves the directory in place when Electron exits. An SSH heartbeat closes Electron on channel loss. It creates no login item, service, or application installation.
- Dependency lifecycle scripts stay disabled. The npm build downloads the pinned Electron package's official current-platform archive and verifies the checksum bundled with that exact package before extraction. npm and Electron download caches remain governed by those tools.
- The configured GipPity URL must be a credential-free HTTPS origin.
- GipPity's self-signed certificate is accepted only for that exact configured origin and only for an unknown-authority error.
- Chromium sandboxing, context isolation, and web security remain enabled; Node integration is disabled.
- Navigation stays within the configured origin. New windows and permission requests fail closed.
- The preload bridge carries only validated cursor positions.

GipPity's trusted-LAN policy remains authoritative. Do not expose its server to an untrusted network or public reverse proxy.
