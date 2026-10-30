import type { CoreClient } from "./client.js";
import { focusCoreWindow } from "./focus-window.js";
import { object } from "./protocol.js";
import { RemoteCoreEndpoint } from "./remote-endpoint.js";
import { terminalPane, terminalSnapshot } from "./terminal.js";

function unavailableFocus(): Error {
	return Object.assign(
		new Error(
			"Focus is unavailable: the Herdr window cannot confirm which Core it controls. Use hc attach with the terminal address on this Core; messages and supervision remain available.",
		),
		{ code: "SHEPHERDR_DELIVERY_REJECTED" },
	);
}

/** Translate legacy connection operations to Core without owning connection lifetime. */
export async function dispatchCoreRequest(
	core: CoreClient | RemoteCoreEndpoint,
	method: string,
	params: Record<string, unknown>,
	timeoutMs: number,
): Promise<unknown> {
	const options = { timeoutMs };
	switch (method) {
		case "ping":
			return core.request("hello", {}, options);
		case "session.snapshot":
			return {
				snapshot: terminalSnapshot(
					await core.request("terminal.list", {}, options),
				),
			};
		case "agent.get": {
			const listing = object(await core.request("terminal.list", {}, options));
			const snapshot = terminalSnapshot(listing);
			const terminals = listing["terminals"];
			// Include finished and non-Pi terminals: an address must not redirect.
			const exact =
				Array.isArray(terminals) &&
				terminals.some(
					(terminal) => object(terminal)["address"] === params["target"],
				);
			const matches = exact
				? []
				: snapshot.agents.filter((agent) => agent.name === params["target"]);
			if (matches.length > 1)
				throw new Error("Agent name is ambiguous; use its terminal address");
			return {
				agent: terminalPane(
					await core.request(
						"terminal.get",
						{ terminal: matches[0]?.terminal_id ?? params["target"] },
						options,
					),
				),
			};
		}
		case "pane.get":
		case "pane.current":
			return {
				pane: terminalPane(
					await core.request(
						"terminal.get",
						{ terminal: params["pane_id"] ?? params["caller_pane_id"] },
						options,
					),
				),
			};
		case "agent.read": {
			const result = object(
				await core.request(
					"terminal.read",
					{
						terminal: params["target"],
						lines: params["source"] === "visible" ? 0 : params["lines"],
					},
					options,
				),
			);
			return {
				read: {
					text: result["text"],
					truncated: result["complete"] === false,
				},
			};
		}
		case "agent.focus":
			if (core instanceof RemoteCoreEndpoint) throw unavailableFocus();
			if (typeof params["target"] !== "string")
				throw new Error("Use the exact local terminal address");
			return focusCoreWindow(core, params["target"]);
		case "workspace.close":
		case "tab.close":
			throw new Error(
				"Window-location cleanup is unavailable through Core; close only the created terminal by its exact address",
			);
		case "terminal.close":
		case "pane.close": {
			const terminal = params["pane_id"] ?? params["id"];
			if (typeof terminal !== "string" || !/^t[0-9a-z]+$/.test(terminal))
				throw new Error(
					"Cleanup requires an exact local Core terminal address",
				);
			const current = object(
				await core.request("terminal.get", { terminal }, options),
			);
			if (current["address"] !== terminal)
				throw new Error(
					"Core terminal identity changed; resolve the target again",
				);
			if (current["state"] === "live")
				await core.request("terminal.kill", { terminal }, options);
			else if (current["state"] !== "finished")
				throw new Error(
					"Core terminal state is unknown; inspect it before cleanup",
				);
			return core.request("terminal.rm", { terminal }, options);
		}
		default:
			throw new Error(
				`Action ${method} is unavailable through Core; use Core terminal operations or the Herdr window commands`,
			);
	}
}
