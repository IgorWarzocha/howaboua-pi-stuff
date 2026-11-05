import { isIP } from "node:net";

export interface NativePlaybackDiagnostics {
	source: "native-playback";
	clientId: string;
	hostUnixMs: number;
	local: string;
	peer: string;
	client: Record<string, number | null>;
	helper: Record<string, number | null>;
}

const CLIENT_FIELDS =
	"unix_ms probe_id ssh_forwarded host_reports_enabled log_queue_drops elapsed_ms window_ms packets bytes suppressed_packets suppressed receive_age_ms max_receive_gap_us max_helper_write_us max_capture_send_us max_helper_read_queue_us round_trip_us host_echo_unix_ms host_echo_client_unix_ms".split(
		" ",
	);
const HELPER_FIELDS =
	"window_ms packets callbacks empty_callbacks partial_callbacks nonzero_partial_callbacks nonzero_resumes nonzero_callbacks receive_age_ms callback_age_ms nonzero_age_ms max_receive_gap_us max_callback_gap_us queue_frames max_queue_frames callback_frames_min callback_frames_max starts max_start_delay_us clears drain_requests drain_acks input_xruns output_xruns rate device_delay_us held_callbacks inserted_zero_frames".split(
		" ",
	);

function counters(
	value: unknown,
	fields: string[],
): Record<string, number | null> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	const result: Record<string, number | null> = {};
	for (const field of fields) {
		const item = Reflect.get(value, field);
		if (
			item !== null &&
			(typeof item !== "number" || !Number.isSafeInteger(item) || item < 0)
		)
			return;
		result[field] = item;
	}
	return result;
}

function endpoint(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 80) return false;
	const match = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(value);
	return (
		!!match &&
		isIP(match[1] ?? match[2] ?? "") !== 0 &&
		Number(match[3]) <= 65535
	);
}

/** An allowlist prevents native telemetry becoming a transcript/secret log sink. */
export function nativePlaybackDiagnostics(
	value: Record<string, unknown>,
	clientId: string,
): NativePlaybackDiagnostics | undefined {
	if (
		value["version"] !== 1 ||
		!endpoint(value["local"]) ||
		!endpoint(value["peer"])
	)
		return;
	const client = counters(value["client"], CLIENT_FIELDS);
	const helper = counters(value["helper"], HELPER_FIELDS);
	if (!client || !helper) return;
	return {
		source: "native-playback",
		clientId,
		hostUnixMs: Date.now(),
		local: value["local"],
		peer: value["peer"],
		client,
		helper,
	};
}
