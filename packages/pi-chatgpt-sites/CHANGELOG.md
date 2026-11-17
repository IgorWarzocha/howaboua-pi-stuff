# @howaboua/pi-chatgpt-sites

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
