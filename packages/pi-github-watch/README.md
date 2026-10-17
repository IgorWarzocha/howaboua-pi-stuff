# GitHub Watch

Opt-in GitHub comment and Actions run watches that wake the same Pi session. Notifications contain a URL and comment count or run conclusion, never comment bodies or job logs. The agent reads the details with `gh`.

## Install

```sh
pi install npm:@howaboua/pi-github-watch
```

Requires Pi 1.2 or later and an authenticated `gh` CLI. Works with structured tools, Pi native Code mode and Codex Conversion Code mode.

## Watch a thread

Ask the agent to watch a worthwhile thread, such as an issue awaiting an answer or a PR awaiting bot reviews. Nothing is watched automatically.

The `github_watch` tool accepts a GitHub URL in its `thread` field, `owner/repo#123`, or a bare issue/PR number resolved through `gh repo view` in the current working directory. Call it without arguments for help. Its actions are `watch`, `status` and `cancel`.

Issues are checked every minute. PRs take an initial metadata snapshot immediately, wait seven minutes before the first check, then check every minute. PR watches include conversation comments, submitted reviews and inline review comments. Existing comments and edits do not trigger notifications.

Thread watches continue after a notification.

## Watch an Actions run

Give the agent a run URL such as `https://github.com/owner/repo/actions/runs/123`. The same `thread` field accepts it. Run IDs are not accepted as bare numbers, which still mean issues or PRs.

Runs are checked every minute. A watch follows the run's latest attempt and stops after notifying the session of its conclusion, including success, failure or cancellation. An already-completed run returns its result immediately without starting a watch. To watch a later rerun, start a new watch.

## Lifetime and recovery

Watches survive ordinary compaction but end on cancellation, session switch, reload or process shutdown. They are not restored when reopening a session. Failed checks pause the affected watch and show an error. Start the watch again after checking authentication and access to the watched URL.

Notifications arrive chronologically through the existing Codex Conversion delivery integration when available, otherwise as native Pi user messages. They queue behind an active response and start a turn when idle. No system prompt changes are used.
