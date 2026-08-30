export function waitForTurn(
	promise: Promise<void>,
	signal?: AbortSignal,
): Promise<void> {
	if (!signal) return promise;
	if (signal.aborted) {
		return Promise.reject(signal.reason ?? new Error("Operation aborted"));
	}
	return new Promise((resolveValue, reject) => {
		const abort = () => reject(signal.reason ?? new Error("Operation aborted"));
		signal.addEventListener("abort", abort, { once: true });
		void promise.then(
			() => {
				signal.removeEventListener("abort", abort);
				resolveValue();
			},
			(error: unknown) => {
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
	});
}
