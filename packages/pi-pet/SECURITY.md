# Security model

Pi Pet adds no listener, credential store, prompt endpoint, or remote session ownership. GipPity Control owns those boundaries.

## Miniapp

- GipPity confines static files to Pi Pet's registered realpath and reserves its SDK/API routes.
- Browser prompts and voice use the hosted `GippityRemote` client rather than a pet-specific transport.
- Custom reaction state is normalized and bounded by GipPity before browser delivery.
- Pet manifests are strict inert JSON. Assets are bounded regular PNG/WebP files; traversal, escaping symlinks, excessive decoded size, and out-of-frame geometry fail during builds.

## Electron

- The configured GipPity URL must be a credential-free HTTPS origin.
- GipPity's self-signed certificate is accepted only for that exact configured origin and only for an unknown-authority error.
- Chromium sandboxing, context isolation, and web security remain enabled; Node integration is disabled.
- Navigation stays within the configured origin. New windows and permission requests fail closed.
- The preload bridge carries only validated cursor positions.

GipPity's trusted-LAN policy remains authoritative. Do not expose its server to an untrusted network or public reverse proxy.
