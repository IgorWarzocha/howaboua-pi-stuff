import type {
	CdpConnection,
	CdpEventWait,
	CdpParams,
} from "../src/cdp/types.js";

export interface CdpCall {
	method: string;
	params: CdpParams;
	sessionId?: string | undefined;
}

export class FakeCdp implements CdpConnection {
	readonly calls: CdpCall[] = [];
	private readonly handler: (call: CdpCall) => unknown | Promise<unknown>;

	constructor(handler: (call: CdpCall) => unknown | Promise<unknown>) {
		this.handler = handler;
	}

	async send(
		method: string,
		params: CdpParams = {},
		sessionId?: string,
	): Promise<unknown> {
		const call = {
			method,
			params,
			...(sessionId ? { sessionId } : {}),
		};
		this.calls.push(call);
		return this.handler(call);
	}

	onEvent(): () => void {
		return () => undefined;
	}

	waitForEvent(): CdpEventWait {
		return {
			promise: Promise.resolve({}),
			cancel() {},
		};
	}
}
