# @howaboua/pi-subdir-agents

## 0.0.4

- Fixed repeated AGENTS.md context injection during repository discovery. Unchanged guidance stays deduplicated; new and edited files still load.

## 0.0.3

- Fixed developer-role AGENTS.md context always displaying in full. Messages now show file paths and expand with Ctrl+O.

## 0.0.2

- Deliver nested AGENTS.md guidance as developer messages when Pi Codex is active, retaining standalone tool-result delivery and branch-aware deduplication.

## 0.0.1

### Changes

- [#339](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/339) [`ee0220c`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ee0220cdc44cd732dff9caf0c913e098ed14404f) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Load nested AGENTS.md context when repository discovery reaches a subdirectory.
