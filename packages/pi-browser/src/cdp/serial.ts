export function waitForTurn<T>(
	promise: Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) {
		return Promise.reject(signal.reason ?? new Error("Operation aborted"));
	}
	return new Promise<T>((resolveValue, reject) => {
		const abort = () => reject(signal.reason ?? new Error("Operation aborted"));
		signal.addEventListener("abort", abort, { once: true });
		void promise.then(
			(value) => {
				signal.removeEventListener("abort", abort);
				resolveValue(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
	});
}
