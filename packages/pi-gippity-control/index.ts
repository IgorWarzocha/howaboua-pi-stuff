import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGippityControl } from "./src/register.ts";

export default function gippityControl(pi: ExtensionAPI): void {
	registerGippityControl(pi);
}
