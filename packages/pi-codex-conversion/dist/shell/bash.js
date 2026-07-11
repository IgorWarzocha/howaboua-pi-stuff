import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let parser;
let parserPromise;
export function initializeBashParser() {
    parserPromise ??= createBashParser().then((created) => {
        parser = created;
    });
}
export function hasBashAstSupport() {
    return parser !== undefined;
}
export function extractBashCommand(command) {
    if (command.length !== 3)
        return undefined;
    const [shell, flag, script] = command;
    if (flag !== "-lc" && flag !== "-c")
        return undefined;
    const shellName = shell.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
    if (shellName !== "bash" && shellName !== "zsh" && shellName !== "sh")
        return undefined;
    return [shell, script];
}
export function tryParseShell(shellLcArg) {
    if (!parser)
        initializeBashParser();
    return parser?.parse(shellLcArg) ?? undefined;
}
export function tryParseWordOnlyCommandsSequence(tree, src) {
    if (tree.rootNode.hasError) {
        return undefined;
    }
    const allowedKinds = new Set([
        "program",
        "list",
        "pipeline",
        "command",
        "command_name",
        "word",
        "string",
        "string_content",
        "raw_string",
        "number",
        "concatenation",
    ]);
    const allowedPunctuation = new Set(["&&", "||", ";", "|", '"', "'"]);
    const commandNodes = [];
    const stack = [tree.rootNode];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node)
            continue;
        if (node.isNamed) {
            if (!allowedKinds.has(node.type))
                return undefined;
            if (node.type === "command")
                commandNodes.push(node);
        }
        else {
            if ([...node.type].some((char) => "&;|".includes(char)) && !allowedPunctuation.has(node.type)) {
                return undefined;
            }
            if (!allowedPunctuation.has(node.type) && node.type.trim().length > 0) {
                return undefined;
            }
        }
        for (const child of node.children) {
            stack.push(child);
        }
    }
    commandNodes.sort((left, right) => left.startIndex - right.startIndex);
    const commands = [];
    for (const node of commandNodes) {
        const parsed = parsePlainCommandFromNode(node, src);
        if (!parsed)
            return undefined;
        commands.push(parsed);
    }
    return commands;
}
export function parseShellLcPlainCommands(command) {
    const bash = extractBashCommand(command);
    if (!bash)
        return undefined;
    const [, script] = bash;
    const tree = tryParseShell(script);
    if (!tree)
        return undefined;
    return tryParseWordOnlyCommandsSequence(tree, script);
}
export function parseShellLcSingleCommandPrefix(command) {
    const bash = extractBashCommand(command);
    if (!bash)
        return undefined;
    const [, script] = bash;
    const tree = tryParseShell(script);
    if (!tree || tree.rootNode.hasError)
        return undefined;
    if (!hasNamedDescendantKind(tree.rootNode, "heredoc_redirect"))
        return undefined;
    const commandNode = findSingleCommandNode(tree.rootNode);
    if (!commandNode)
        return undefined;
    return parseHeredocCommandWords(commandNode, script);
}
async function createBashParser() {
    try {
        const { Language, Parser } = await import("web-tree-sitter");
        await Parser.init();
        const language = await Language.load(require.resolve("tree-sitter-bash/tree-sitter-bash.wasm"));
        const parser = new Parser();
        parser.setLanguage(language);
        return parser;
    }
    catch {
        return undefined;
    }
}
function parsePlainCommandFromNode(command, src) {
    if (command.type !== "command")
        return undefined;
    const words = [];
    for (const child of command.namedChildren) {
        switch (child.type) {
            case "command_name": {
                const wordNode = child.namedChild(0);
                if (!wordNode || wordNode.type !== "word")
                    return undefined;
                words.push(textOf(wordNode, src));
                break;
            }
            case "word":
            case "number":
                words.push(textOf(child, src));
                break;
            case "string": {
                const parsed = parseDoubleQuotedString(child, src);
                if (parsed === undefined)
                    return undefined;
                words.push(parsed);
                break;
            }
            case "raw_string": {
                const parsed = parseRawString(child, src);
                if (parsed === undefined)
                    return undefined;
                words.push(parsed);
                break;
            }
            case "concatenation": {
                let concatenated = "";
                for (const part of child.namedChildren) {
                    switch (part.type) {
                        case "word":
                        case "number":
                            concatenated += textOf(part, src);
                            break;
                        case "string": {
                            const parsed = parseDoubleQuotedString(part, src);
                            if (parsed === undefined)
                                return undefined;
                            concatenated += parsed;
                            break;
                        }
                        case "raw_string": {
                            const parsed = parseRawString(part, src);
                            if (parsed === undefined)
                                return undefined;
                            concatenated += parsed;
                            break;
                        }
                        default:
                            return undefined;
                    }
                }
                if (concatenated.length === 0)
                    return undefined;
                words.push(concatenated);
                break;
            }
            default:
                return undefined;
        }
    }
    return words;
}
function parseHeredocCommandWords(command, src) {
    if (command.type !== "command")
        return undefined;
    const words = [];
    for (const child of command.namedChildren) {
        switch (child.type) {
            case "command_name": {
                const wordNode = child.namedChild(0);
                if (!wordNode || !(wordNode.type === "word" || wordNode.type === "number") || !isLiteralWordOrNumber(wordNode))
                    return undefined;
                words.push(textOf(wordNode, src));
                break;
            }
            case "word":
            case "number":
                if (!isLiteralWordOrNumber(child))
                    return undefined;
                words.push(textOf(child, src));
                break;
            case "variable_assignment":
            case "comment":
                break;
            case "heredoc_body":
            case "simple_heredoc_body":
            case "heredoc_redirect":
            case "herestring_redirect":
            case "file_redirect":
            case "redirected_statement":
                break;
            default:
                return undefined;
        }
    }
    return words.length > 0 ? words : undefined;
}
function isLiteralWordOrNumber(node) {
    if (node.type !== "word" && node.type !== "number")
        return false;
    return node.namedChildren.length === 0;
}
function findSingleCommandNode(root) {
    const stack = [root];
    let singleCommand;
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node)
            continue;
        if (node.type === "command") {
            if (singleCommand)
                return undefined;
            singleCommand = node;
        }
        for (const child of node.namedChildren) {
            stack.push(child);
        }
    }
    return singleCommand;
}
function hasNamedDescendantKind(node, kind) {
    const stack = [node];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current)
            continue;
        if (current.type === kind)
            return true;
        for (const child of current.namedChildren) {
            stack.push(child);
        }
    }
    return false;
}
function parseDoubleQuotedString(node, src) {
    if (node.type !== "string")
        return undefined;
    for (const part of node.namedChildren) {
        if (part.type !== "string_content")
            return undefined;
    }
    const raw = textOf(node, src);
    if (!raw.startsWith('"') || !raw.endsWith('"'))
        return undefined;
    return raw.slice(1, -1);
}
function parseRawString(node, src) {
    if (node.type !== "raw_string")
        return undefined;
    const raw = textOf(node, src);
    if (!raw.startsWith("'") || !raw.endsWith("'"))
        return undefined;
    return raw.slice(1, -1);
}
function textOf(node, _src) {
    return node.text;
}
