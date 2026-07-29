import { generateKeyPairSync, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces, hostname } from "node:os";
import { join } from "node:path";
import { generate } from "selfsigned";

const CERTIFICATE_DAYS = 365;
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1_000;

export interface LanVoiceCertificate {
	cert: string;
	key: string;
	hostnames: string[];
	ipAddresses: string[];
}

export function resolveLanVoiceCertificate(agentDir: string): LanVoiceCertificate {
	const hostnames = [
		...new Set([hostname(), "localhost"].filter(Boolean)),
	].sort();
	const ipAddresses = lanAddresses();
	const identities = [
		...hostnames.map((value) => `dns:${value}`),
		...ipAddresses.map((value) => `ip:${value}`),
	].sort();
	const directory = join(agentDir, "lan-voice");
	const certPath = join(directory, "certificate.pem");
	const keyPath = join(directory, "private-key.pem");
	const metadataPath = join(directory, "certificate-identities.json");
	if (certificateIsReusable(certPath, keyPath, metadataPath, identities)) {
		return {
			cert: readFileSync(certPath, "utf8"),
			key: readFileSync(keyPath, "utf8"),
			hostnames,
			ipAddresses,
		};
	}

	const keyPair = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { format: "pem", type: "pkcs8" },
		publicKeyEncoding: { format: "pem", type: "spki" },
	});
	const generated = generate(
		[{ name: "commonName", value: hostnames[0] ?? "localhost" }],
		{
			algorithm: "sha256",
			days: CERTIFICATE_DAYS,
			keyPair: { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey },
			extensions: [
				{ name: "basicConstraints", cA: false },
				{ name: "keyUsage", digitalSignature: true, keyEncipherment: true },
				{ name: "extKeyUsage", serverAuth: true },
				{
					name: "subjectAltName",
					altNames: [
						...hostnames.map((value) => ({ type: 2, value })),
						...ipAddresses.map((ip) => ({ type: 7, ip })),
					],
				},
			],
		} as Parameters<typeof generate>[1] & { keyPair: { privateKey: string; publicKey: string } },
	);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	writeFileSync(certPath, generated.cert, { mode: 0o600 });
	writeFileSync(keyPath, generated.private, { mode: 0o600 });
	writeFileSync(metadataPath, `${JSON.stringify({ identities }, null, 2)}\n`, {
		mode: 0o600,
	});
	return {
		cert: generated.cert,
		key: generated.private,
		hostnames,
		ipAddresses,
	};
}

function lanAddresses(): string[] {
	const addresses = ["127.0.0.1"];
	for (const [name, entries] of Object.entries(networkInterfaces())) {
		if (/^(?:br-|docker|veth|virbr)/.test(name)) continue;
		for (const entry of entries ?? []) {
			if (entry.family === "IPv4" && !entry.internal)
				addresses.push(entry.address);
		}
	}
	return [...new Set(addresses)].sort();
}

function certificateIsReusable(
	certPath: string,
	keyPath: string,
	metadataPath: string,
	identities: string[],
): boolean {
	if (
		!existsSync(certPath) ||
		!existsSync(keyPath) ||
		!existsSync(metadataPath)
	)
		return false;
	try {
		const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
			identities?: unknown;
		};
		if (
			!Array.isArray(metadata.identities) ||
			metadata.identities.join("\n") !== identities.join("\n")
		)
			return false;
		const certificate = new X509Certificate(readFileSync(certPath));
		return Date.parse(certificate.validTo) - Date.now() > RENEW_BEFORE_MS;
	} catch {
		return false;
	}
}
