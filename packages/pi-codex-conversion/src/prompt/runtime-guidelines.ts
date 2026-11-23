import type { ExecutionMode } from "../adapter/activation/execution-mode.ts";
import type { PiSystemPromptOptions } from "./build-system-prompt.ts";

const PI_DEFAULT_GUIDELINES = new Set([
	"Use bash for file operations like ls, rg, find",
	"Be concise in your responses",
	"Show file paths clearly when working with files",
]);

export function formatRuntimeGuidelines(
	options: PiSystemPromptOptions,
	config: {
		executionMode: ExecutionMode;
		heavySystemPromptOverwrite: boolean;
		replacePiScaffold: boolean;
		piPackageRoot?: string;
		shell?: string | undefined;
		nestedTools: readonly string[];
		customization: string;
	},
): string {
	const {
		executionMode,
		heavySystemPromptOverwrite,
		replacePiScaffold,
		shell,
		piPackageRoot,
	} = config;
	const active = new Set(options.selectedTools);
	const rules: string[] = [];
	const add = (plain: string, compact: string) =>
		rules.push(heavySystemPromptOverwrite ? compact : plain);

	if (replacePiScaffold)
		rules.push(
			...options.selectedTools
				.filter((name) => !options.hiddenTools.includes(name))
				.flatMap((name) => options.toolGuidelines[name] ?? []),
			...options.promptGuidelines,
		);
	if (executionMode === "normal") {
		if (active.has("exec_command")) {
			add(
				"Use exec_command for shell commands. Filter large output at the source.",
				"Shell→exec_command; filter large output at source",
			);
			add(
				"Set tty=true only for input or persistent processes.",
				"tty=true only for input or persistent processes",
			);
		}
		if (active.has("apply_patch"))
			add(
				"Use apply_patch to edit, create, delete, or move files. Split oversized patches.",
				"Text edits, creates, deletes, moves→apply_patch; split oversized patches",
			);
		add(
			"Run independent calls in parallel when practical.",
			"Independent calls→parallel when practical",
		);
	} else if (
		active.has("exec") &&
		active.has("wait") &&
		(executionMode !== "ts" || active.has("notebook"))
	) {
		if (executionMode !== "code")
			add("You may reuse verified bindings.", "Reuse verified bindings only");
		add(
			"Bind complex strings before calling tools from JavaScript. Check quotes, commas, and closing delimiters before sending.",
			"JS calls: bind complex strings first; check quotes, commas, delimiters",
		);
		add(
			"Group related calls in one JavaScript cell and use their results to decide what to do next. Use text() to show the outcome, a blocker, or a decision needed.",
			"Related calls→one JS cell; branch or loop on results; text()→outcome, blocker or decision",
		);
		if (executionMode === "ts") {
			add(
				"Use notebook({}) to manage state. Clean up retained bindings when the task is done.",
				"State→notebook({}); task done→clean up bindings",
			);
			if (config.nestedTools.includes("exec_command"))
				add(
					"Keep canonical artifacts in files. Pass shell state between exec_command calls through files or arguments.",
					"Canonical artifacts→files; shell state across exec_command→files or args",
				);
			add(
				"Run ordinary cells serially. Inspect state after an error before retrying. After a restart, recreate any reported unsaved values.",
				"Ordinary cells→serial; error→inspect state before retry; restart→recreate reported unsaved values",
			);
		}
	}
	if (piPackageRoot)
		rules.push(
			`Pi customization or integration→list ${piPackageRoot} before implementing`,
		);
	if (shell) {
		const name = shell.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
		const zsh = name === "zsh" || name === "zsh.exe";
		add(
			`The shell is ${shell}. Follow its syntax and quoting rules.${zsh ? " In zsh, capture the exit status with rc=$?." : ""}`,
			`Shell=${shell}; follow syntax and quoting${zsh ? "; capture exit status with rc=$?" : ""}`,
		);
	}
	if (config.customization) rules.push(config.customization);
	return [
		...new Set(
			rules
				.map((rule) => rule.trim())
				.filter(
					(rule) =>
						rule &&
						(!replacePiScaffold ||
							!PI_DEFAULT_GUIDELINES.has(rule.replace(/\.$/, ""))),
				),
		),
	].join("\n");
}
