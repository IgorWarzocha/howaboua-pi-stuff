declare module "unzipper" {
	interface Entry {
		path: string;
		type?: string;
		buffer(): Promise<Buffer>;
	}

	export const Open: {
		buffer(input: Buffer): Promise<{ files: Entry[] }>;
	};
}
