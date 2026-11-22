# @howaboua/pi-chatgpt-sites

## 0.0.6

- Added `site.open` to restore an existing Site's committed source into a new local checkout without publishing.
- Fixed saving source with Sites access tokens or an authenticated Work proxy.
- Fixed private deployments for accounts without a shared deployment route.
- Updated the Sites guides for building, access, and connecting Site-hosted MCP tools.
- Sites always uses compact guide and schema discovery, including in standalone installs.

## 0.0.5

- Shorter Sites guides distinguish production authorisation, access checks and recovery after a partial publication.

## 0.0.4

- Requires Pi 1.5 or newer.

  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - Replaced the TypeBox dependency with Pi's native schema builders.

  Sites documentation examples no longer prescribe `await`.

## 0.0.3

- - Sites calls now return their payload directly instead of an outer `result` wrapper.
  - Errors show the problem and recovery information without diagnostic envelopes.
  - GPT mode uses note-style guide and schema discovery.

## 0.0.2

- Streamlined tool descriptions and on-demand help discovery. Guide contents are unchanged.

## 0.0.1

- ### Features
  - Added Pi Sites with site management, committed-source saves, deployment and on-demand documentation.
  - Tools are automatically deferred in Code Mode and Notebook.
