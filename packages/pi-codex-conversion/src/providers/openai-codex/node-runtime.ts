const dynamicImport = (specifier: string) => import(specifier);

export const osInfo: { current: { platform(): string; release(): string; arch(): string } | null } = { current: null };

export const osInfoReady = typeof process !== "undefined" && (process.versions?.node || process.versions["bun"]!)
	? dynamicImport("node:os")
		.then((module) => {
			osInfo.current = module;
		})
		.catch(() => {
			osInfo.current = null;
		})
	: Promise.resolve();
