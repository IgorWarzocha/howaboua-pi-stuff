import { randomUUID, X509Certificate } from "node:crypto";
import { get } from "node:https";
import { isRecord } from "../handoff-wire.ts";
import type { LanVoiceCertificate } from "./certificate.ts";

export interface LanTakeoverIdentity {
	certificate: string;
}
export interface LanTakeoverOffer extends LanTakeoverIdentity {
	token: string;
}
export interface PreparedLanTakeover {
	offer: LanTakeoverOffer;
	certificate: LanVoiceCertificate;
}

export async function prepareLanTakeover(
	agentDir: string,
): Promise<PreparedLanTakeover> {
	const { resolveLanVoiceCertificate } = await import("./certificate.ts");
	const certificate = await resolveLanVoiceCertificate(agentDir);
	return {
		certificate,
		offer: {
			certificate: new X509Certificate(certificate.cert).fingerprint256,
			token: randomUUID(),
		},
	};
}

export function decodeLanTakeoverOffer(value: unknown): LanTakeoverOffer {
	if (
		!isRecord(value) ||
		typeof value["certificate"] !== "string" ||
		typeof value["token"] !== "string" ||
		!/^[a-f0-9-]{36}$/.test(value["token"])
	)
		throw new Error(
			"The selected voice provider does not support same-address LAN takeover; the source remains active",
		);
	return { certificate: value["certificate"], token: value["token"] };
}

export function assertLanTakeoverIdentity(
	source: LanTakeoverIdentity,
	target: LanTakeoverIdentity,
): void {
	if (source.certificate !== target.certificate)
		throw new Error(
			"LAN certificates differ; same-address takeover cannot preserve browser trust. The source remains active",
		);
}

/** A peer must reach this exact certificate-pinned listener through its own loopback. */
export async function verifyLanTakeoverListener(
	certificate: string,
	value: unknown,
): Promise<void> {
	if (
		!isRecord(value) ||
		typeof value["port"] !== "number" ||
		!Number.isInteger(value["port"]) ||
		value["port"] < 1 ||
		value["port"] > 65535 ||
		typeof value["token"] !== "string" ||
		!/^[a-f0-9-]{36}$/.test(value["token"])
	)
		throw new Error("Invalid LAN listener proof");
	const { port, token } = value;
	await new Promise<void>((resolve, reject) => {
		const request = get(
			{
				hostname: "127.0.0.1",
				port,
				path: `/api/takeover-proof?token=${token}`,
				ca: certificate,
				rejectUnauthorized: true,
				agent: false,
			},
			(response) => {
				let body = "";
				response.setEncoding("utf8");
				response.on("data", (chunk: string) => {
					body += chunk;
					if (body.length > 256)
						request.destroy(new Error("Invalid LAN listener proof"));
				});
				response.on("error", reject);
				response.on("end", () =>
					response.statusCode === 200 && body === token
						? resolve()
						: reject(
								new Error(
									"The target could not verify the source LAN listener on this machine",
								),
							),
				);
			},
		);
		request.setTimeout(5_000, () =>
			request.destroy(
				new Error(
					"Same-address LAN takeover requires a reachable listener on this machine",
				),
			),
		);
		request.on("error", reject);
	});
}

/** Only the reconnect carrying the source token may use the prepared snapshot. */
export class LanTakeoverArrival<T> {
	private pending: { token: string; value: T; expiresAt: number } | undefined;

	constructor(token: string | undefined, value: T | undefined) {
		if (token && value !== undefined)
			this.pending = { token, value, expiresAt: Date.now() + 20_000 };
	}

	consume(token?: string): T | undefined {
		if (this.pending && Date.now() >= this.pending.expiresAt)
			this.pending = undefined;
		const pending = this.pending;
		if (!token) {
			if (pending)
				throw new Error("Voice transfer is reconnecting. Try again shortly");
			return undefined;
		}
		if (!pending || pending.token !== token)
			throw new Error(
				"Voice reconnect expired. Start voice again to use current session context",
			);
		this.pending = undefined;
		return pending.value;
	}
}
