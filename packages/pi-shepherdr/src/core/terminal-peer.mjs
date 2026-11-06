/** @typedef {Pick<import('../types.js').PaneInfo, 'pane_id' | 'terminal_id' | 'agent' | 'agent_session'>} PeerTerminal */
/** @typedef {{terminal:(address:string)=>Promise<PeerTerminal>,closeTerminal:(address:string)=>Promise<void>}} TerminalPeer */

/** Native terminal identity and lifecycle shared by local and bundled peer delivery.
 * @param {(method:string,params:Record<string,unknown>)=>Promise<unknown>} request
 * @returns {TerminalPeer}
 */
export function terminalPeer(request) {
	/** @param {string} address */
	async function get(address) {
		if (!/^t[1-9][0-9bcdfghjkmnpqrstvwxyz]*$/.test(address))
			throw new Error("Use an exact terminal address from this machine");
		const value = await request("terminal.get", { terminal: address });
		if (
			!value ||
			typeof value !== "object" ||
			!("address" in value) ||
			value.address !== address ||
			!("state" in value)
		)
			throw new Error("Terminal identity changed; resolve the target again");
		return value;
	}
	return {
		async terminal(address) {
			const record = await get(address);
			const labels = "labels" in record ? record.labels : undefined;
			const path =
				labels && typeof labels === "object" && "pi.session_file" in labels
					? labels["pi.session_file"]
					: undefined;
			return {
				pane_id: address,
				terminal_id: address,
				agent: typeof path === "string" && path ? "pi" : null,
				...(typeof path === "string" && path
					? {
							agent_session: {
								agent: "pi",
								kind: /** @type {const} */ ("path"),
								source: "pi.session_file",
								value: path,
							},
						}
					: {}),
			};
		},
		async closeTerminal(address) {
			const record = await get(address);
			if (record.state === "live")
				await request("terminal.kill", { terminal: address });
			else if (record.state !== "finished")
				throw new Error("Terminal state is unknown; inspect it before cleanup");
			await request("terminal.rm", { terminal: address });
		},
	};
}
