const TERMINAL = /^t[1-9][0-9bcdfghjkmnpqrstvwxyz]*$/;
const ENDED = new Set([
	"holder_lost",
	"stopped_by_restart",
	"server_stop",
	"host_shutdown",
	"signaled",
]);

function program(record) {
	return Number.isSafeInteger(record.pid) && record.pid > 0
		? record.pid
		: undefined;
}

/** Core's native parent links and lifetime flags are the only ownership source. */
export async function superviseParents(core, warn) {
	const children = new Map();
	const parents = new Map();
	let active = true;
	let chain = Promise.resolve();
	let streamWarning;
	function enqueue(work) {
		chain = chain
			.then(() => active && work())
			.catch((error) => {
				if (active)
					warn(
						`Automatic child shutdown could not be checked: ${error.message}. Existing agents remain available. Reconnect Core or close the children explicitly.`,
					);
			});
	}
	function forget(address) {
		const child = children.get(address);
		if (!child) return;
		children.delete(address);
		const parent = parents.get(child.record.parent);
		parent?.children.delete(address);
		if (parent?.children.size === 0) parents.delete(child.record.parent);
	}
	async function track(record, verify = true) {
		if (!record || !TERMINAL.test(record.address)) return;
		const previous = children.get(record.address);
		if (
			record.state !== "live" ||
			record.die_with_parent !== true ||
			typeof record.parent !== "string" ||
			!record.parent.includes("/") ||
			!TERMINAL.test(record.parent.split("/").at(-1)) ||
			!program(record)
		) {
			forget(record.address);
			return;
		}
		if (
			previous?.record.parent === record.parent &&
			program(previous.record) === program(record)
		) {
			previous.record = record;
			return;
		}
		forget(record.address);
		let parent = parents.get(record.parent);
		if (!parent) {
			parent = {
				reference: record.parent,
				children: new Map(),
				warning: undefined,
			};
			parents.set(record.parent, parent);
		}
		const child = { record, parentProgram: undefined };
		children.set(record.address, child);
		parent.children.set(record.address, child);
		// Read the actual parent, never infer its death from an aggregate omission.
		if (verify) await check(parent);
	}
	async function check(parent) {
		try {
			const record = await core.request(
				"terminal.get",
				{
					terminal: parent.reference,
				},
				2000,
			);
			if (!active) return;
			if (
				!record ||
				typeof record.address !== "string" ||
				record.address.split("/").at(-1) !== parent.reference.split("/").at(-1)
			)
				throw new Error("Parent terminal identity was not confirmed");
			const current = program(record);
			const ended =
				record.state === "finished" ||
				(record.state === "live" &&
					record.pid === null &&
					ENDED.has(record.reason));
			if (!ended && (record.state !== "live" || !current))
				throw new Error("Parent program state is unknown");
			for (const child of [...parent.children.values()]) {
				if (!active) return;
				if (
					!ended &&
					(!child.parentProgram || child.parentProgram === current)
				) {
					child.parentProgram = current;
					continue;
				}
				const target = child.record.address;
				const live = await core.request(
					"terminal.get",
					{ terminal: target },
					2000,
				);
				if (!active) return;
				if (
					live.address === target &&
					live.state === "live" &&
					live.parent === parent.reference &&
					live.die_with_parent === true &&
					program(live) === program(child.record)
				)
					await core.request("terminal.kill", { terminal: target }, 2000);
				forget(target);
			}
			parent.warning = undefined;
		} catch (error) {
			if (!active) return;
			const message = `Automatic shutdown for children of ${parent.reference} is unavailable: ${error.message}. Existing agents remain available. Reconnect the parent Core or close these children explicitly.`;
			if (parent.warning !== message) warn(message);
			parent.warning = message;
		}
	}
	async function checkAll() {
		await Promise.all([...parents.values()].map(check));
	}
	const subscription = core.subscribe(
		{},
		(message) => {
			enqueue(async () => {
				if (message.method === "snapshot" || message.method === "missed") {
					const local = message.terminals.filter((record) =>
						TERMINAL.test(record.address),
					);
					const addresses = new Set(local.map((record) => record.address));
					for (const address of children.keys())
						if (!addresses.has(address)) forget(address);
					for (const record of local) await track(record, false);
					await checkAll();
				} else if (message.method === "event") {
					const event = message.event;
					if (TERMINAL.test(event.terminal)) {
						if (["finished", "lost", "removed"].includes(event.type))
							forget(event.terminal);
						else if (["created", "restarted"].includes(event.type))
							await track(event.data);
					}
					// Remote removal can mean a dropped mirror, not a dead parent.
					// Every trigger is verified through a fresh, directly routed read.
					if (["finished", "lost", "restarted", "removed"].includes(event.type))
						await checkAll();
				}
			});
		},
		(error) => {
			streamWarning = error;
			if (active)
				warn(
					`Automatic child shutdown is unavailable: ${error.message}. Existing agents remain available. Reconnect Core or close the children explicitly.`,
				);
		},
	);
	try {
		await subscription.ready;
		if (streamWarning) throw streamWarning;
	} catch (error) {
		active = false;
		subscription.close();
		throw error;
	}
	return {
		async close() {
			await chain;
			// Pi releases connections during shutdown, before its program exits.
			// Keep observing briefly, then verify once. A lost wire is not death.
			if (parents.size) {
				await new Promise((resolve) => setTimeout(resolve, 1500));
				enqueue(checkAll);
				await chain;
			}
			active = false;
			subscription.close();
			children.clear();
			parents.clear();
		},
	};
}
