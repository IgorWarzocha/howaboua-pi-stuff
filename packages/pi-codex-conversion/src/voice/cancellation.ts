export const CANCELLED = Symbol("voice-operation-cancelled");

export function interruptible<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T | typeof CANCELLED> {
	if (!signal) return operation;
	if (signal.aborted) return Promise.resolve(CANCELLED);
	return new Promise((resolve, reject) => {
		const onAbort = () => { signal.removeEventListener("abort", onAbort); resolve(CANCELLED); };
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then(
			(value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
			(error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
		);
	});
}
