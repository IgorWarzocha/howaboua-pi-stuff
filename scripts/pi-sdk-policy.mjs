export const PI_PEER_RANGE = ">=1.0.0";

export function pi1PeerDependencies(peers = {}) {
	return Object.fromEntries(Object.entries(peers).map(([name, range]) => [
		name,
		name.startsWith("@earendil-works/pi-") ? PI_PEER_RANGE : range,
	]));
}
