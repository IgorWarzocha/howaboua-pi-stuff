export function nextEventLoopTurn(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
