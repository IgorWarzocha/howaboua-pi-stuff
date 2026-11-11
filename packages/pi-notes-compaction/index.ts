import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommunicationGuidance } from "./src/guidance.js";
import { createNotesFeature } from "./src/notes/feature.js";

export default function notesCompaction(pi: ExtensionAPI): void {
	const notes = createNotesFeature(pi);
	registerCommunicationGuidance(pi, notes);
}
