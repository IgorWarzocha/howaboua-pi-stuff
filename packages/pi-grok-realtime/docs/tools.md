# Local voice tools

Pi extensions can expose functions directly to Grok during a voice call. They run locally in the current Pi session, without delegating to the Pi agent.

Import `registerGrokTool` from `@howaboua/pi-grok-realtime/tools`. Pass the Pi extension API and a definition with `name`, `description`, a TypeBox `parameters` schema, and `execute(args, { signal, ctx, callId })`. Import `Type` from `@earendil-works/pi-ai`. Argument types are inferred from the schema and validated using Pi's argument validator before execution.

Return a JSON-compatible value or a promise of one. Undefined, non-finite numbers, class instances and circular values fail visibly. Execution errors are reported as tool failures. Use `ctx` for the current session. Preserve normal approval requirements when exposing actions.

Speaking over Grok does not cancel a started action. The call's shutdown signal stops waiting for a result, but cannot undo work. Handlers must cooperate with `signal` to stop asynchronous work when the call ends.

Register during extension loading. The helper returns an unsubscribe function. Pi also removes subscriptions on reload. Tools are collected once at call start, regardless of extension load order. Registration changes apply to the next call. Duplicate names fail collection. `send_task`, `end_the_call` and `work_landed` are reserved.

## Try the example

With this package installed, copy `examples/local-tool.ts` into `.pi/extensions/` in your project, then reload Pi. Start a new voice call and ask for the current time, optionally naming an IANA time zone such as `Europe/London`. The example only reads the clock.

Keep both Grok Realtime and your extension loaded in the same Pi session. Registration does not add a tool to Pi's working model. No separate server, tool dispatcher or voice connection is needed.

## Provider-native web search

Enable Web search in `/grok` settings and start a new call. Grok Realtime adds `{ "type": "web_search" }` to xAI's session tools. xAI executes it, so there is no local `execute` callback. Provider tool charges may apply. Keep it disabled when research should stay with Pi.

xAI also reports native searches as function-call events. These are displayed as reported queries, not dispatched locally or answered with function outputs. Search results and sources are not exposed in the observed realtime events. A local tool named `web_search` cannot share a call with native Web search.

## Development checks

- Give the tool one clear purpose and describe when to use it. Do not put secrets in descriptions, parameters or results.
- Use `additionalProperties: false` for closed argument objects. Return useful facts or action receipts, not invented success.
- Pass `signal` to cancellable APIs such as `fetch`. Registering a tool does not supply approval UI or authorization.
- Results and failures enter voice context and session diagnostics. Return only information appropriate for the caller.
- Start a fresh call after reloading. Diagnose missing tools from the saved `session.update` tools list and inspect `function_call_output` for validation or execution errors.
