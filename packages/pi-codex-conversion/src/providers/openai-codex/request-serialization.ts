/** Gateways can route before buffering input. Apply after all payload rewrites. */
export function serializeCodexRequest<
	T extends {
		model: string;
		stream?: boolean;
		service_tier?: string | undefined;
	},
>(body: T): string {
	const { model, stream, service_tier, ...rest } = body;
	return JSON.stringify({ model, stream, service_tier, ...rest });
}
