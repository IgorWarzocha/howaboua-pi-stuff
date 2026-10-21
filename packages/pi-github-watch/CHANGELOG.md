# @howaboua/pi-github-watch

## 0.0.3

- Use denser watch help in PCC GPT prompt mode.

## 0.0.2

- - Added GitHub Actions run watches that wake the session when a run finishes. Completed runs return their result immediately.
  - Added consistent tool discovery across native, Code and Notebook modes, with compact help in PCC GPT prompt mode.
  - PR watches now surface unresolved review threads, including existing feedback, without repeated notifications for unchanged threads. Notices encourage replies and resolution after feedback is addressed.
  - Conversation watches now detect edits while ignoring the authenticated account's replies and duplicate inline-review receipts.
  - PR watches now stop when the PR is closed or merged. Already-closed PRs return their state without starting a watch.

## 0.0.1

- Initial release: opt-in GitHub issue and PR comment watches, with delayed PR checks and notifications that wake the same session across providers.
