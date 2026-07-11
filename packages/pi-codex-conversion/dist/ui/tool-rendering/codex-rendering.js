import { summarizeShellCommand } from "../../shell/summary.js";
export function renderExecCommandCall(command, state, theme) {
    const summary = summarizeShellCommand(command);
    return summary.maskAsExplored ? renderExplorationText([summary.actions], state, theme) : renderCommandText(command, state, theme);
}
export function renderGroupedExecCommandCall(actionGroups, state, theme) {
    return renderExplorationText(actionGroups, state, theme);
}
export function renderWriteStdinCall(sessionId, input, command, theme) {
    const interacted = typeof input === "string" && input.length > 0;
    const marker = interacted ? "↳ " : "• ";
    const title = interacted ? "Interacted with background terminal" : "Waited for background terminal";
    let text = `${theme.fg("dim", marker)}${theme.bold(title)}`;
    const commandPreview = formatCommandPreview(command);
    if (commandPreview) {
        text += `${theme.fg("dim", " · ")}${theme.fg("muted", commandPreview)}`;
    }
    // Keep the session fallback only when we do not have a stable command display.
    if (!commandPreview) {
        text += `${theme.fg("dim", " ")}${theme.fg("muted", `#${sessionId}`)}`;
    }
    return text;
}
function renderExplorationText(actionGroups, state, theme) {
    const header = state === "running" ? "Exploring" : "Explored";
    let text = `${theme.fg("dim", "•")} ${theme.bold(header)}`;
    for (const [index, line] of coalesceReadGroups(actionGroups).map(formatActionLine).entries()) {
        const prefix = index === 0 ? "  └ " : "    ";
        text += `\n${theme.fg("dim", prefix)}${theme.fg("accent", line.title)} ${theme.fg("muted", line.body)}`;
    }
    return text;
}
function renderCommandText(command, state, theme) {
    const verb = state === "running" ? "Running" : "Ran";
    let text = `${theme.fg("dim", "•")} ${theme.bold(verb)}`;
    for (const [index, line] of formatCommandLines(command).entries()) {
        const prefix = index === 0 ? "  └ " : "    ";
        text += `\n${theme.fg("dim", prefix)}${theme.fg("accent", line)}`;
    }
    return text;
}
function formatCommandLines(command, maxLines = 5) {
    const lines = command
        .replace(/\t/g, "   ")
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line, index, all) => line.length > 0 || (index > 0 && index < all.length - 1));
    const visible = lines.slice(0, maxLines).map((line) => shortenLine(line));
    if (lines.length > maxLines) {
        visible.push("...");
    }
    return visible.length > 0 ? visible : [""];
}
function shortenLine(line, max = 100) {
    const trimmed = line.trim();
    if (trimmed.length <= max)
        return trimmed;
    return `${trimmed.slice(0, max - 3)}...`;
}
function shortenCommand(command, max = 100) {
    const trimmed = command.replace(/\s+/g, " ").trim();
    if (trimmed.length <= max)
        return trimmed;
    return `${trimmed.slice(0, max - 3)}...`;
}
function formatCommandPreview(command) {
    if (!command)
        return undefined;
    const singleLine = command.replace(/\s+/g, " ").trim();
    if (singleLine.length === 0)
        return undefined;
    return shortenCommand(singleLine, 80);
}
function formatActionLine(action) {
    if (action.kind === "read") {
        return { title: "Read", body: formatReadLabel(action) };
    }
    if (action.kind === "list") {
        return { title: "List", body: action.path ?? action.command };
    }
    if (action.kind === "search") {
        if (action.query && action.path) {
            return { title: "Search", body: `${action.query} in ${action.path}` };
        }
        if (action.query) {
            return { title: "Search", body: action.query };
        }
        return { title: "Search", body: action.command };
    }
    return { title: "Run", body: action.command };
}
function formatReadLabel(action) {
    const skillName = skillNameFromSkillPath(action.path);
    return skillName ? `${skillName} skill` : action.name;
}
function skillNameFromSkillPath(path) {
    const normalized = path.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.at(-1) !== "SKILL.md")
        return undefined;
    if (parts.at(-3) !== "skills")
        return undefined;
    const skillDir = parts.at(-2);
    return skillDir && skillDir !== ".system" ? skillDir : undefined;
}
function coalesceReadGroups(actionGroups) {
    const flattened = [];
    for (let index = 0; index < actionGroups.length; index += 1) {
        const actions = actionGroups[index];
        if (actions.every((action) => action.kind === "read")) {
            const reads = [];
            const seenPaths = new Set();
            let lastRead;
            for (let readIndex = index; readIndex < actionGroups.length; readIndex += 1) {
                const readActions = actionGroups[readIndex];
                if (!readActions.every((action) => action.kind === "read")) {
                    break;
                }
                for (const action of readActions) {
                    if (action.kind !== "read")
                        continue;
                    lastRead = action;
                    if (seenPaths.has(action.path))
                        continue;
                    seenPaths.add(action.path);
                    reads.push(action);
                }
                index = readIndex;
            }
            if (lastRead) {
                const duplicateLabels = new Set();
                const seenLabels = new Set();
                for (const read of reads) {
                    const label = formatReadLabel(read);
                    if (seenLabels.has(label)) {
                        duplicateLabels.add(label);
                        continue;
                    }
                    seenLabels.add(label);
                }
                const labels = reads.map((read) => {
                    const label = formatReadLabel(read);
                    return duplicateLabels.has(label) ? read.path : label;
                });
                flattened.push({
                    kind: "read",
                    command: labels.join(" && "),
                    name: labels.join(", "),
                    path: "",
                });
            }
            continue;
        }
        flattened.push(...actions);
    }
    return flattened;
}
