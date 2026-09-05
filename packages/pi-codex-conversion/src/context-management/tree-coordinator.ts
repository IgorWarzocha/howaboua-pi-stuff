import {
	contentText,
	type ImageContent,
	type TextContent,
} from "@earendil-works/pi-ai";
import type {
	BranchSummaryEntry,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	InputEvent,
	InputEventResult,
	SessionEntry,
	SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import type { ContextWindowIdentity } from "./messages.ts";
import {
	CONTEXT_NOTE_SNAPSHOT_ENTRY_TYPE,
	createPiSessionNotesSnapshot,
} from "./local-notes.ts";
import {
	TREE_ARCHIVE_ENTRY_TYPE,
	buildTreeArchiveIndex,
	createTreeArchiveManifest,
} from "./tree-archive.ts";
import {
	CodexContextWindowManager,
	findLatestWindowBoundaryEntry,
} from "./window-manager.ts";

const CAPTURE_COMMAND = "pi-codex-context-tree-capture";

interface CapturedCommandContext {
	sessionId: string;
	ctx: ExtensionCommandContext;
}

interface PendingRollover {
	sessionId: string;
	boundaryEntryId: string;
	identity: ContextWindowIdentity;
	leafIdAtRequest: string;
}

interface Navigation {
	oldLeafId: string;
	savedEditorText: string;
	targetEditorText?: string | undefined;
	summaryEntry?: BranchSummaryEntry | undefined;
}

interface QueuedInput {
	text: string;
	images?: ImageContent[] | undefined;
}

export class CodexContextTreeCoordinator {
	private readonly windows: CodexContextWindowManager;
	private captured: CapturedCommandContext | undefined;
	private pending: PendingRollover | undefined;
	private navigation: Navigation | undefined;
	private queuedInputs: QueuedInput[] = [];

	constructor(windows: CodexContextWindowManager) {
		this.windows = windows;
	}

	register(pi: ExtensionAPI): void {
		pi.registerCommand(CAPTURE_COMMAND, {
			handler: async (_args, ctx) => {
				this.captured = {
					sessionId: ctx.sessionManager.getSessionId(),
					ctx,
				};
			},
		});
	}

	beginSession(pi: ExtensionAPI): void {
		this.reset();
		pi.sendUserMessage(`/${CAPTURE_COMMAND}`, {
			expandPromptTemplates: true,
		});
	}

	reset(): void {
		this.captured = undefined;
		this.pending = undefined;
		this.navigation = undefined;
		this.queuedInputs = [];
	}

	schedule(ctx: ExtensionContext): boolean {
		if (this.pending) return false;
		const sessionId = ctx.sessionManager.getSessionId();
		if (!this.captured || this.captured.sessionId !== sessionId)
			throw new Error("Tree context management is not ready for this session");
		const identity = this.windows.currentIdentity();
		const branch = ctx.sessionManager.getBranch();
		const boundary = findLatestWindowBoundaryEntry(branch);
		const leaf = branch.at(-1);
		if (
			!identity ||
			!boundary ||
			!leaf ||
			boundary.details.contextManagement.currentWindowId !==
				identity.currentWindowId
		)
			throw new Error("No active context window can be archived");
		this.pending = {
			sessionId,
			boundaryEntryId: boundary.id,
			identity,
			leafIdAtRequest: leaf.id,
		};
		ctx.abort();
		return true;
	}

	interceptInput(event: InputEvent): InputEventResult | undefined {
		if (!this.navigation) return undefined;
		this.queuedInputs.push({
			text: event.text,
			...(event.images ? { images: [...event.images] } : {}),
		});
		return { action: "handled" };
	}

	handleSessionTree(event: SessionTreeEvent): boolean {
		if (!this.navigation || event.oldLeafId !== this.navigation.oldLeafId)
			return false;
		if (event.summaryEntry) this.navigation.summaryEntry = event.summaryEntry;
		return true;
	}

	async settle(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
		const pending = this.pending;
		if (!pending) return false;
		try {
			const branch = ctx.sessionManager.getBranch();
			const allEntries = ctx.sessionManager.getEntries();
			this.assertReadyToNavigate(pending, branch, ctx);
			const target = rolloverTarget(pending.boundaryEntryId, allEntries, branch);
			const oldLeaf = branch.at(-1);
			if (!target || !oldLeaf)
				throw new Error("Tree archive target is no longer available");
			const snapshot = createPiSessionNotesSnapshot(branch);
			this.navigation = {
				oldLeafId: oldLeaf.id,
				savedEditorText: ctx.ui.getEditorText(),
				targetEditorText: editorTextForEntry(target),
			};
			const result = await this.captured!.ctx.navigateTree(target.id, {
				summarize: true,
			});
			if (result.cancelled) throw new Error("Tree archive was cancelled");
			const summary = this.navigation.summaryEntry ??
				findNavigationSummary(ctx.sessionManager.getBranch(), oldLeaf.id);
			if (!summary) throw new Error("Pi did not create a branch summary");
			this.restoreEditorAfterNavigation(ctx, this.navigation);
			pi.appendEntry(
				TREE_ARCHIVE_ENTRY_TYPE,
				createTreeArchiveManifest(
					pending.identity.currentWindowId,
					pending.boundaryEntryId,
					summary,
				),
			);
			pi.appendEntry(CONTEXT_NOTE_SNAPSHOT_ENTRY_TYPE, snapshot);
			this.pending = undefined;
			const started = await this.windows.startNewWindow(pi, ctx, {
				triggerTurn: true,
				mode: "tree",
				trimPreviousWindow: false,
			});
			if (!started) throw new Error("A new context window could not be started");
			this.navigation = undefined;
			this.replayInputs(pi, this.takeQueuedInputs());
			return true;
		} catch (error) {
			const queued = this.takeQueuedInputs();
			const navigation = this.navigation;
			this.pending = undefined;
			this.navigation = undefined;
			ctx.ui.notify(
				`Tree context rollover failed: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
			this.restoreQueuedInputToEditor(ctx, navigation, queued);
			return false;
		}
	}

	private assertReadyToNavigate(
		pending: PendingRollover,
		branch: readonly SessionEntry[],
		ctx: ExtensionContext,
	): void {
		if (
			ctx.sessionManager.getSessionId() !== pending.sessionId ||
			!this.captured ||
			this.captured.sessionId !== pending.sessionId
		)
			throw new Error("The active session changed before rollover");
		if (!branch.some((entry) => entry.id === pending.leafIdAtRequest))
			throw new Error("The active branch changed before rollover");
		if (!branch.some((entry) => entry.id === pending.boundaryEntryId))
			throw new Error("The context-window boundary is no longer active");
	}

	private restoreEditorAfterNavigation(
		ctx: ExtensionContext,
		navigation: Navigation,
	): void {
		if (
			navigation.targetEditorText !== undefined &&
			ctx.ui.getEditorText() === navigation.targetEditorText
		)
			ctx.ui.setEditorText(navigation.savedEditorText);
	}

	private takeQueuedInputs(): QueuedInput[] {
		const queued = this.queuedInputs;
		this.queuedInputs = [];
		return queued;
	}

	private replayInputs(
		pi: ExtensionAPI,
		queued: readonly QueuedInput[],
	): void {
		for (const input of queued) {
			pi.sendUserMessage(inputContent(input), {
				deliverAs: "followUp",
				expandPromptTemplates: true,
			});
		}
	}

	private restoreQueuedInputToEditor(
		ctx: ExtensionContext,
		navigation: Navigation | undefined,
		queued: readonly QueuedInput[],
	): void {
		const text = [
			navigation?.savedEditorText ?? "",
			...queued.map((input) => input.text),
		].filter(Boolean).join("\n\n");
		if (text) ctx.ui.setEditorText(text);
		if (queued.some((input) => input.images?.length))
			ctx.ui.notify("Resend the image attachments from the interrupted input", "warning");
	}
}

function rolloverTarget(
	boundaryEntryId: string,
	allEntries: readonly SessionEntry[],
	branch: readonly SessionEntry[],
): SessionEntry | undefined {
	const boundaryIndex = branch.findIndex((entry) => entry.id === boundaryEntryId);
	if (boundaryIndex < 0) return undefined;
	const index = buildTreeArchiveIndex(allEntries, branch);
	if (index.archives.length > 0 || index.invalidManifest)
		return branch[boundaryIndex];
	for (let index = 0; index < boundaryIndex; index += 1) {
		const entry = branch[index];
		if (
			entry &&
			((entry.type === "message" && entry.message.role === "user") ||
				entry.type === "custom_message")
		)
			return entry;
	}
	return branch[boundaryIndex];
}

function editorTextForEntry(entry: SessionEntry): string | undefined {
	if (entry.type === "message" && entry.message.role === "user")
		return contentText(entry.message.content);
	if (entry.type === "custom_message") return contentText(entry.content);
	return undefined;
}

function findNavigationSummary(
	branch: readonly SessionEntry[],
	oldLeafId: string,
): BranchSummaryEntry | undefined {
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type === "branch_summary" && entry.fromId === oldLeafId)
			return entry;
	}
	return undefined;
}

function inputContent(input: QueuedInput): string | (TextContent | ImageContent)[] {
	if (!input.images?.length) return input.text;
	return [
		...(input.text ? [{ type: "text" as const, text: input.text }] : []),
		...input.images,
	];
}
