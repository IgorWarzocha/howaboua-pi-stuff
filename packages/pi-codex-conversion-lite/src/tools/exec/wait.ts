export interface WaitableSession {
	exitCode: number | null | undefined;
	listeners: Set<() => void>;
}

export function registerAbortHandler(signal: AbortSignal | undefined, onAbort: () => void): () => void {
	if (!signal) return () => {};
	if (signal.aborted) {
		onAbort();
		return () => {};
	}
	const abortListener = () => onAbort();
	signal.addEventListener("abort", abortListener, { once: true });
	return () => signal.removeEventListener("abort", abortListener);
}

export function waitForExitOrTimeout(session: WaitableSession, yieldTimeMs: number, signal?: AbortSignal, onUpdate?: (elapsedMs: number) => void): Promise<number> {
	if (session.exitCode !== undefined && session.exitCode !== null) return Promise.resolve(0);
	if (signal?.aborted) return Promise.resolve(0);

	const startedAt = Date.now();
	let updateTimer: ReturnType<typeof setInterval> | undefined;
	let lastUpdateAt = 0;
	return new Promise((resolvePromise) => {
		let abortCleanup: (() => void) | undefined;
		let done = false;
		const cleanup = () => {
			clearTimeout(timeout);
			if (updateTimer) clearInterval(updateTimer);
			abortCleanup?.();
			session.listeners.delete(onWake);
		};
		const finish = () => {
			if (done) return;
			done = true;
			cleanup();
			resolvePromise(Date.now() - startedAt);
		};
		const emitUpdate = (force = false) => {
			const now = Date.now();
			if (!force && now - lastUpdateAt < 250) return;
			lastUpdateAt = now;
			onUpdate?.(now - startedAt);
		};
		const onWake = () => {
			if (session.exitCode === undefined || session.exitCode === null) {
				emitUpdate();
				return;
			}
			emitUpdate(true);
			finish();
		};
		const timeout = setTimeout(finish, yieldTimeMs);
		abortCleanup = registerAbortHandler(signal, finish);
		if (onUpdate) updateTimer = setInterval(emitUpdate, 250);
		session.listeners.add(onWake);
	});
}
