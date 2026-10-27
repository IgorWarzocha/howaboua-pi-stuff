import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { PaneInfo, PeerChannel } from "../types.js";
import { createBufferedChannel } from "./shepherdr-channel.mjs";

/** Owns admitted duplex channels; the transport closes all on its single teardown path. */
export class FocusChannels {
	private readonly channels = new Map<
		string,
		ReturnType<typeof createBufferedChannel>
	>();
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly closed: () => boolean;
	constructor(child: ChildProcessWithoutNullStreams, closed: () => boolean) {
		this.child = child;
		this.closed = closed;
	}
	async open(
		agent: PaneInfo,
		request: import("../types.js").FocusRequest,
		call: (
			message: Record<string, unknown>,
			timeoutMs: number,
		) => Promise<unknown>,
	): Promise<PeerChannel> {
		const id = randomUUID();
		const state = createBufferedChannel(
			(message) => {
				const frame = `${JSON.stringify({ op: "channel_send", id, message })}\n`;
				if (
					this.closed() ||
					this.child.stdin.writableLength + Buffer.byteLength(frame) >
						1024 * 1024
				)
					throw new Error(
						"Focus channel output is unavailable or exceeded its buffer",
					);
				this.child.stdin.write(frame);
			},
			() => {
				this.channels.delete(id);
				if (!this.closed())
					this.child.stdin.write(
						`${JSON.stringify({ op: "channel_close", id })}\n`,
					);
			},
		);
		this.channels.set(id, state);
		try {
			const result = await call(
				{ op: "channel_open", id, agent, request },
				60_000,
			);
			if (
				!result ||
				typeof result !== "object" ||
				!("admitted" in result) ||
				result.admitted !== true
			)
				throw new Error("Focus channel was not admitted");
			return state.channel;
		} catch (error) {
			state.fail(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}

	consume(value: Record<string, unknown>): boolean {
		if (value["type"] === "channel" && typeof value["channel"] === "string") {
			const state = this.channels.get(value["channel"]);
			if (value["closed"] === true)
				state?.fail(
					new Error(
						typeof value["error"] === "string"
							? value["error"]
							: "Focus channel disconnected",
					),
				);
			else if ("message" in value) state?.receive(value["message"]);
			else state?.fail(new Error("Invalid focus channel frame"));
			return true;
		}
		return false;
	}
	failAll(error: Error) {
		for (const state of this.channels.values()) state.fail(error);
		this.channels.clear();
	}
}
