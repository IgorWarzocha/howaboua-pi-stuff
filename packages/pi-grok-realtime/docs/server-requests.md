# Starting browser control from another process

`/grok server ensure` starts the LAN listener if stopped and leaves an existing listener untouched. `/grok server status` reports its current state without starting it. Both wait for earlier server operations. Bare `/grok server` still toggles browser control.

`/grok server connect <browser-route> <UUID-v4-request-id> [server-url]` ensures the listener, opens a voice tab on the selected Pi Browser route and starts voice once. Use `local` for this machine's browser, or an explicitly configured remote route. It reports success only after the page acknowledges listening with the browser microphone connected. Certificate, microphone, routing and account failures remain visible. It does not change permissions or certificate trust.

The default URL uses this server's hostname for remote browsers. Local browsers prefer a returned `localhost` URL, falling back to the server hostname. An explicit URL must appear in the running listener's URLs. Remote browsers cannot use loopback URLs. Choose an address the selected browser can resolve and reach.

Connect refuses to replace an active call or attached browser. Repeating its request ID during the current Pi runtime replays the original receipt without another browser action. A fresh ID does not override an active call. A failed or timed-out attempt may leave its tab open, so inspect it before trying again.

For a machine-readable acknowledgement, append a fresh UUID v4:

```text
/grok server ensure 78246126-915c-4be7-a8b1-2a7a033aa902
/grok server status 15392952-2207-46d9-b005-5622866918c6
```

Pi writes `<agentDir>/runtime/voice-requests/<requestId>.json` atomically, including startup failures. The directory is private and files use mode `0600` on POSIX. Without a request ID, results appear in Pi's UI only. Invalid IDs are rejected in the UI and create no receipt.

```json
{
	"version": 1,
	"requestId": "78246126-915c-4be7-a8b1-2a7a033aa902",
	"action": "ensure",
	"sessionId": "the-current-pi-session-id",
	"terminalId": "t1",
	"provider": "grok",
	"status": "running",
	"running": true,
	"urls": ["https://host:43121"],
	"browserAttached": false
}
```

`status` is `running`, `stopped` or `error`. Failures add an `error` string, while `running` and `urls` describe the actual listener. `terminalId` is the inherited `HC_TERMINAL_ID`, or `null` outside Core. `browserAttached` means an open browser audio WebSocket, not a working microphone or connected voice provider. A running listener alone does not open a browser or start a call.

Connect receipts use `action: "connect"` and add `browserRoute`, `browserStatus` (`listening`, `error` or `timeout`), plus `browserUrl` and `browserRefId` when available. Failed browser attempts include `browserError`. An error receipt can have `running: true`: the listener remains available even when browser voice did not start.

The caller must use a fresh ID, verify the request, session and terminal identities, then remove its receipt. Receipts are snapshots, not ongoing status files. If the private directory is unavailable or unsafe, Pi reports a write failure in its UI instead. A missing receipt never proves that startup did not happen.

Commands submitted as terminal input require an empty editor and the intended Pi session. Browser control remains restricted to a trusted LAN and may require accepting the local certificate. This command does not configure remote routing or certificate trust.

Core's `hc send` adds a sender wrapper when invoked from another agent terminal. Wrapped text is chat, not a slash command. An external caller without inherited `HC_TERMINAL_ID`, `HC_TERMINAL_SOCKET` or `HC_SESSION` can use `hc send` against its configured Core. Do not change the Core endpoint accidentally when removing those variables. Always wait for and verify the receipt rather than interpreting `started: false` as failure: slash commands do not start a model turn.

For a direct call to the intended Core endpoint, use its supported `terminal.send` method with `caller: null`:

```json
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "terminal.send",
	"params": {
		"terminal": "t1",
		"caller": null,
		"text": "/grok server connect laptop 78246126-915c-4be7-a8b1-2a7a033aa902"
	}
}
```
