import { isAbsoluteLike, joinCommandTokens, joinPaths, shortDisplayPath } from "./tokenize.js";
export function parseShellPart(tokens, cwd) {
    if (tokens.length === 0)
        return null;
    if (tokens[0] === "cd") {
        return null;
    }
    const parsed = parseMainTokens(tokens);
    if (parsed === null)
        return null;
    if (parsed.kind === "run")
        return parsed;
    if (parsed.kind === "read" && cwd && !isAbsoluteLike(parsed.path)) {
        return {
            ...parsed,
            path: joinPaths(cwd, parsed.path),
        };
    }
    return parsed;
}
export function nextCwd(currentCwd, tokens) {
    if (tokens[0] !== "cd")
        return currentCwd;
    const target = cdTarget(tokens.slice(1));
    if (!target)
        return currentCwd;
    return currentCwd ? joinPaths(currentCwd, target) : target;
}
export function isSmallFormattingCommand(tokens) {
    if (tokens.length === 0)
        return false;
    const [head, ...tail] = tokens;
    if (head === "wc" ||
        head === "tr" ||
        head === "cut" ||
        head === "sort" ||
        head === "uniq" ||
        head === "tee" ||
        head === "column" ||
        head === "yes" ||
        head === "printf") {
        return true;
    }
    if (head === "xargs") {
        return !xargsIsMutatingSubcommand(tail);
    }
    if (head === "awk") {
        return awkDataFileOperand(tail) === undefined;
    }
    if (head === "head") {
        if (tail.length === 0)
            return true;
        if (tail.length === 1)
            return tail[0].startsWith("-");
        if (tail.length === 2 && (tail[0] === "-n" || tail[0] === "-c") && /^\d+$/.test(tail[1]))
            return true;
        return false;
    }
    if (head === "tail") {
        if (tail.length === 0)
            return true;
        if (tail.length === 1)
            return tail[0].startsWith("-");
        if (tail.length === 2 && (tail[0] === "-n" || tail[0] === "-c")) {
            const value = tail[1]?.startsWith("+") ? tail[1].slice(1) : tail[1];
            if (value && /^\d+$/.test(value))
                return true;
        }
        return false;
    }
    if (head === "sed") {
        return sedReadPath(tail) === undefined;
    }
    return false;
}
function parseMainTokens(tokens) {
    const [head, ...tail] = tokens;
    if (!head)
        return null;
    const command = joinCommandTokens(tokens);
    if (head === "echo" ||
        head === "true" ||
        head === "printf" ||
        head === "wc" ||
        head === "tr" ||
        head === "cut" ||
        head === "sort" ||
        head === "uniq" ||
        head === "tee" ||
        head === "column" ||
        head === "yes") {
        return null;
    }
    if (head === "xargs") {
        return xargsIsMutatingSubcommand(tail) ? { kind: "run", command } : null;
    }
    if (head === "ls" || head === "eza" || head === "exa") {
        const flagsWithValues = head === "ls"
            ? ["-I", "-w", "--block-size", "--format", "--time-style", "--color", "--quoting-style"]
            : ["-I", "--ignore-glob", "--color", "--sort", "--time-style", "--time"];
        const path = firstNonFlagOperand(tail, flagsWithValues);
        return { kind: "list", command, path: path ? shortDisplayPath(path) : undefined };
    }
    if (head === "tree") {
        const path = firstNonFlagOperand(tail, ["-L", "-P", "-I", "--charset", "--filelimit", "--sort"]);
        return { kind: "list", command, path: path ? shortDisplayPath(path) : undefined };
    }
    if (head === "du") {
        const path = firstNonFlagOperand(tail, ["-d", "--max-depth", "-B", "--block-size", "--exclude", "--time-style"]);
        return { kind: "list", command, path: path ? shortDisplayPath(path) : undefined };
    }
    if (head === "rg" || head === "rga" || head === "ripgrep-all") {
        const args = trimAtConnector(tail);
        const hasFilesFlag = args.includes("--files");
        const candidates = skipFlagValues(args, [
            "-g",
            "--glob",
            "--iglob",
            "-t",
            "--type",
            "--type-add",
            "--type-not",
            "-m",
            "--max-count",
            "-A",
            "-B",
            "-C",
            "--context",
            "--max-depth",
        ]);
        const nonFlags = candidates.filter((token) => !token.startsWith("-"));
        if (hasFilesFlag) {
            const path = nonFlags[0];
            return { kind: "list", command, path: path ? shortDisplayPath(path) : undefined };
        }
        return {
            kind: "search",
            command,
            query: nonFlags[0],
            path: nonFlags[1] ? shortDisplayPath(nonFlags[1]) : undefined,
        };
    }
    if (head === "git" && tail[0] === "grep") {
        return parseGrepLike(command, tail.slice(1));
    }
    if (head === "git" && tail[0] === "ls-files") {
        const path = firstNonFlagOperand(tail.slice(1), ["--exclude", "--exclude-from", "--pathspec-from-file"]);
        return { kind: "list", command, path: path ? shortDisplayPath(path) : undefined };
    }
    if (head === "fd") {
        const [query, path] = parseFdQueryAndPath(tail);
        if (query) {
            return { kind: "search", command, query, path };
        }
        return { kind: "list", command, path };
    }
    if (head === "find") {
        const [query, path] = parseFindQueryAndPath(tail);
        if (query) {
            return { kind: "search", command, query, path };
        }
        return { kind: "list", command, path };
    }
    if (head === "grep" || head === "egrep" || head === "fgrep") {
        return parseGrepLike(command, tail);
    }
    if (head === "ag" || head === "ack" || head === "pt") {
        const args = trimAtConnector(tail);
        const candidates = skipFlagValues(args, ["-G", "-g", "--file-search-regex", "--ignore-dir", "--ignore-file", "--path-to-ignore"]);
        const nonFlags = candidates.filter((token) => !token.startsWith("-"));
        return {
            kind: "search",
            command,
            query: nonFlags[0],
            path: nonFlags[1] ? shortDisplayPath(nonFlags[1]) : undefined,
        };
    }
    if (head === "cat") {
        const path = singleNonFlagOperand(tail, []);
        return path ? readAction(command, path) : { kind: "run", command };
    }
    if (head === "bat" || head === "batcat") {
        const path = singleNonFlagOperand(tail, [
            "--theme",
            "--language",
            "--style",
            "--terminal-width",
            "--tabs",
            "--line-range",
            "--map-syntax",
        ]);
        return path ? readAction(command, path) : { kind: "run", command };
    }
    if (head === "less") {
        const path = singleNonFlagOperand(tail, [
            "-p",
            "-P",
            "-x",
            "-y",
            "-z",
            "-j",
            "--pattern",
            "--prompt",
            "--tabs",
            "--shift",
            "--jump-target",
        ]);
        return path ? readAction(command, path) : { kind: "run", command };
    }
    if (head === "more") {
        const path = singleNonFlagOperand(tail, []);
        return path ? readAction(command, path) : { kind: "run", command };
    }
    if (head === "head") {
        const path = readPathFromHeadTail(tail, "head");
        return path ? readAction(command, path) : null;
    }
    if (head === "tail") {
        const path = readPathFromHeadTail(tail, "tail");
        return path ? readAction(command, path) : null;
    }
    if (head === "awk") {
        const path = awkDataFileOperand(tail);
        return path ? readAction(command, path) : { kind: "run", command };
    }
    if (head === "nl") {
        const candidates = skipFlagValues(tail, ["-s", "-w", "-v", "-i", "-b"]);
        const path = candidates.find((token) => !token.startsWith("-"));
        return path ? readAction(command, path) : null;
    }
    if (head === "sed") {
        const path = sedReadPath(tail);
        return path ? readAction(command, path) : null;
    }
    if (isPythonCommand(head)) {
        return pythonWalksFiles(tail) ? { kind: "list", command } : { kind: "run", command };
    }
    return { kind: "run", command };
}
function parseGrepLike(command, tail) {
    const args = trimAtConnector(tail);
    const operands = [];
    let pattern;
    let afterDoubleDash = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (afterDoubleDash) {
            operands.push(arg);
            continue;
        }
        if (arg === "--") {
            afterDoubleDash = true;
            continue;
        }
        if (arg === "-e" || arg === "--regexp") {
            if (!pattern)
                pattern = (args[index + 1]);
            index += 1;
            continue;
        }
        if (arg === "-f" || arg === "--file") {
            if (!pattern)
                pattern = (args[index + 1]);
            index += 1;
            continue;
        }
        if (arg === "-m" ||
            arg === "--max-count" ||
            arg === "-C" ||
            arg === "--context" ||
            arg === "-A" ||
            arg === "--after-context" ||
            arg === "-B" ||
            arg === "--before-context") {
            index += 1;
            continue;
        }
        if (arg.startsWith("-"))
            continue;
        operands.push(arg);
    }
    const hasPattern = pattern !== undefined;
    const query = pattern ?? operands[0];
    const pathIndex = hasPattern ? 0 : 1;
    const path = operands[pathIndex] ? shortDisplayPath(operands[pathIndex]) : undefined;
    return { kind: "search", command, query, path };
}
function parseFdQueryAndPath(tail) {
    const args = trimAtConnector(tail);
    const candidates = skipFlagValues(args, ["-t", "--type", "-e", "--extension", "-E", "--exclude", "--search-path"]);
    const nonFlags = candidates.filter((token) => !token.startsWith("-"));
    if (nonFlags.length === 1) {
        if (isPathish(nonFlags[0]))
            return [undefined, shortDisplayPath(nonFlags[0])];
        return [nonFlags[0], undefined];
    }
    if (nonFlags.length >= 2) {
        return [nonFlags[0], shortDisplayPath(nonFlags[1])];
    }
    return [undefined, undefined];
}
function parseFindQueryAndPath(tail) {
    const args = trimAtConnector(tail);
    let path;
    for (const arg of args) {
        if (!arg.startsWith("-") && arg !== "!" && arg !== "(" && arg !== ")") {
            path = shortDisplayPath(arg);
            break;
        }
    }
    let query;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "-name" || arg === "-iname" || arg === "-path" || arg === "-regex") {
            query = (args[index + 1]);
            break;
        }
    }
    return [query, path];
}
function readAction(command, path) {
    return {
        kind: "read",
        command,
        name: shortDisplayPath(path),
        path,
    };
}
function readPathFromHeadTail(args, tool) {
    if (args.length === 1 && !args[0].startsWith("-")) {
        return args[0];
    }
    const tokens = trimAtConnector(args);
    let index = 0;
    while (index < tokens.length) {
        const token = tokens[index];
        if (!token)
            break;
        if (!token.startsWith("-")) {
            return token;
        }
        if ((token === "-n" || token === "-c") && index + 1 < tokens.length) {
            index += 2;
            continue;
        }
        if ((tool === "head" || tool === "tail") && /^-[nc].+/.test(token)) {
            index += 1;
            continue;
        }
        index += 1;
    }
    return undefined;
}
function sedReadPath(args) {
    const tokens = trimAtConnector(args);
    if (!tokens.includes("-n"))
        return undefined;
    let hasRangeScript = false;
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if ((token === "-e" || token === "--expression") && isValidSedRange((tokens[index + 1]))) {
            hasRangeScript = true;
        }
        if (!token.startsWith("-") && isValidSedRange(token)) {
            hasRangeScript = true;
        }
    }
    if (!hasRangeScript)
        return undefined;
    const candidates = skipFlagValues(tokens, ["-e", "-f", "--expression", "--file"]);
    const nonFlags = candidates.filter((token) => !token.startsWith("-"));
    if (nonFlags.length === 0)
        return undefined;
    if (isValidSedRange(nonFlags[0]))
        return nonFlags[1];
    return nonFlags[0];
}
function isValidSedRange(value) {
    if (!value || !value.endsWith("p"))
        return false;
    const core = value.slice(0, -1);
    const parts = core.split(",");
    return parts.length >= 1 && parts.length <= 2 && parts.every((part) => part.length > 0 && /^\d+$/.test(part));
}
function trimAtConnector(tokens) {
    const index = tokens.findIndex((token) => token === "|" || token === "&&" || token === "||" || token === ";");
    return index === -1 ? [...tokens] : tokens.slice(0, index);
}
function skipFlagValues(args, flagsWithValues) {
    const out = [];
    let skipNext = false;
    for (let index = 0; index < args.length; index++) {
        const token = args[index];
        if (skipNext) {
            skipNext = false;
            continue;
        }
        if (token === "--") {
            out.push(...args.slice(index + 1));
            break;
        }
        if (token.startsWith("--") && token.includes("=")) {
            continue;
        }
        if (flagsWithValues.includes(token)) {
            if (index + 1 < args.length)
                skipNext = true;
            continue;
        }
        out.push(token);
    }
    return out;
}
function positionalOperands(args, flagsWithValues) {
    const out = [];
    let afterDoubleDash = false;
    let skipNext = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (skipNext) {
            skipNext = false;
            continue;
        }
        if (afterDoubleDash) {
            out.push(arg);
            continue;
        }
        if (arg === "--") {
            afterDoubleDash = true;
            continue;
        }
        if (arg.startsWith("--") && arg.includes("=")) {
            continue;
        }
        if (flagsWithValues.includes(arg)) {
            if (index + 1 < args.length)
                skipNext = true;
            continue;
        }
        if (arg.startsWith("-"))
            continue;
        out.push(arg);
    }
    return out;
}
function firstNonFlagOperand(args, flagsWithValues) {
    return (positionalOperands(args, flagsWithValues)[0]);
}
function singleNonFlagOperand(args, flagsWithValues) {
    const operands = positionalOperands(args, flagsWithValues);
    return operands.length === 1 ? operands[0] : undefined;
}
function awkDataFileOperand(args) {
    if (args.length === 0)
        return undefined;
    const tokens = trimAtConnector(args);
    const hasScriptFile = tokens.some((arg) => arg === "-f" || arg === "--file");
    const candidates = skipFlagValues(tokens, ["-F", "-v", "-f", "--field-separator", "--assign", "--file"]);
    const nonFlags = candidates.filter((arg) => !arg.startsWith("-"));
    if (hasScriptFile)
        return nonFlags[0];
    return nonFlags.length >= 2 ? nonFlags[1] : undefined;
}
function pythonWalksFiles(args) {
    const tokens = trimAtConnector(args);
    for (let index = 0; index < tokens.length; index++) {
        if (tokens[index] !== "-c")
            continue;
        const script = (tokens[index + 1]);
        if (!script)
            continue;
        return (script.includes("os.walk") ||
            script.includes("os.listdir") ||
            script.includes("os.scandir") ||
            script.includes("glob.glob") ||
            script.includes("glob.iglob") ||
            script.includes("pathlib.Path") ||
            script.includes(".rglob("));
    }
    return false;
}
function isPythonCommand(command) {
    return (command === "python" ||
        command === "python2" ||
        command === "python3" ||
        command.startsWith("python2.") ||
        command.startsWith("python3."));
}
function isPathish(value) {
    return value === "." || value === ".." || value.startsWith("./") || value.startsWith("../") || value.includes("/") || value.includes("\\");
}
function xargsIsMutatingSubcommand(tokens) {
    const subcommand = xargsSubcommand(tokens);
    if (!subcommand || subcommand.length === 0)
        return false;
    const [head, ...tail] = subcommand;
    if (head === "perl" || head === "ruby")
        return xargsHasInPlaceFlag(tail);
    if (head === "sed")
        return xargsHasInPlaceFlag(tail) || tail.includes("--in-place");
    if (head === "rg")
        return tail.includes("--replace");
    return false;
}
function xargsSubcommand(tokens) {
    let index = 0;
    while (index < tokens.length) {
        const token = tokens[index];
        if (token === "--")
            return tokens.slice(index + 1);
        if (!token.startsWith("-"))
            return tokens.slice(index);
        const takesValue = token === "-E" || token === "-e" || token === "-I" || token === "-L" || token === "-n" || token === "-P" || token === "-s";
        index += takesValue && token.length === 2 ? 2 : 1;
    }
    return undefined;
}
function xargsHasInPlaceFlag(tokens) {
    return tokens.some((token) => token === "-i" || token.startsWith("-i") || token === "-pi" || token.startsWith("-pi"));
}
function cdTarget(args) {
    if (args.length === 0)
        return undefined;
    let target;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--")
            return (args[index + 1]);
        if (arg === "-L" || arg === "-P")
            continue;
        if (arg.startsWith("-"))
            continue;
        target = arg;
    }
    return target;
}
