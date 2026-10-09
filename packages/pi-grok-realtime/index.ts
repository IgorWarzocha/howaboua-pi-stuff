import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGrokRealtime } from "./src/register.ts";

export default function grokRealtime(pi: ExtensionAPI): void {
	registerGrokRealtime(pi);
}
