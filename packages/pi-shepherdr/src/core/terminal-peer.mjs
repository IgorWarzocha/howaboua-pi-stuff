/** @typedef {Pick<import('../types.js').PaneInfo, 'pane_id' | 'terminal_id' | 'agent' | 'agent_session'>} PeerTerminal */
/** @typedef {{terminal:(address:string)=>Promise<PeerTerminal>,closeTerminal:(address:string)=>Promise<void>}} TerminalPeer */

/** Labels survive a kept terminal's program. Only the current Pi status owns them.
 * @param {unknown} record
 * @returns {string | undefined}
 */
export function livePiSession(record) {
	if (
		!record ||
		typeof record !== "object" ||
		!("state" in record) ||
		record.state !== "live" ||
		!("status" in record) ||
		!record.status ||
		typeof record.status !== "object" ||
		!("app" in record.status) ||
		record.status.app !== "pi" ||
		!("labels" in record) ||
		!record.labels ||
		typeof record.labels !== "object" ||
		!("pi.session_file" in record.labels)
	)
		return undefined;
	const path = record.labels["pi.session_file"];
	return typeof path === "string" && path ? path : undefined;
}

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
			const path = livePiSession(record);
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
