import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const PROTOCOL = "@howaboua/pi-gippity-control/lan-service/v1";
const REQUEST_CHANNEL = `${PROTOCOL}/request`;

export interface GippityLanServiceStatus {
	running: boolean;
	urls: string[];
}

interface GippityLanService {
	protocol: typeof PROTOCOL;
	ensure(ctx: ExtensionContext): Promise<GippityLanServiceStatus>;
}

interface GippityLanServiceRequest {
	protocol: typeof PROTOCOL;
	accept(service: GippityLanService): void;
}

function isRequest(value: unknown): value is GippityLanServiceRequest {
	if (!value || typeof value !== "object") return false;
	const request = value as Partial<GippityLanServiceRequest>;
	return request.protocol === PROTOCOL && typeof request.accept === "function";
}

function isService(value: unknown): value is GippityLanService {
	if (!value || typeof value !== "object") return false;
	const service = value as Partial<GippityLanService>;
	return service.protocol === PROTOCOL && typeof service.ensure === "function";
}

export function registerGippityLanService(
	pi: ExtensionAPI,
	ensure: (ctx: ExtensionContext) => Promise<GippityLanServiceStatus>,
): void {
	const service: GippityLanService = { protocol: PROTOCOL, ensure };
	const unregister = pi.events.on(REQUEST_CHANNEL, (value) => {
		if (isRequest(value)) value.accept(service);
	});
	pi.on("session_shutdown", unregister);
}

export async function ensureGippityLan(
	pi: Pick<ExtensionAPI, "events">,
	ctx: ExtensionContext,
): Promise<GippityLanServiceStatus> {
	let service: GippityLanService | undefined;
	const request: GippityLanServiceRequest = {
		protocol: PROTOCOL,
		accept(candidate) {
			if (!service && isService(candidate)) service = candidate;
		},
	};
	pi.events.emit(REQUEST_CHANNEL, request);
	if (!service)
		throw new Error(
			"GipPity Control is unavailable. Install it and reload Pi.",
		);
	const status = await service.ensure(ctx);
	if (!(status.running && status.urls.length > 0))
		throw new Error("GipPity LAN did not provide a display URL.");
	return status;
}
