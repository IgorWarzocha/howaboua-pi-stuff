import type { CdpConnection } from "../types.js";

const MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const;
type Modifier = keyof typeof MODIFIERS;
const ALIASES: Record<string, Modifier> = {
	Ctrl: "Control",
	Cmd: "Meta",
	Option: "Alt",
};
const NAMED_KEYS: Record<string, number> = {
	Backspace: 8,
	Tab: 9,
	Enter: 13,
	Escape: 27,
	Space: 32,
	PageUp: 33,
	PageDown: 34,
	End: 35,
	Home: 36,
	ArrowLeft: 37,
	ArrowUp: 38,
	ArrowRight: 39,
	ArrowDown: 40,
	Insert: 45,
	Delete: 46,
};
const PUNCTUATION: Record<string, { code: string; keyCode: number }> = {
	"`~": { code: "Backquote", keyCode: 192 },
	"-_": { code: "Minus", keyCode: 189 },
	"=+": { code: "Equal", keyCode: 187 },
	"[{": { code: "BracketLeft", keyCode: 219 },
	"]}": { code: "BracketRight", keyCode: 221 },
	"\\|": { code: "Backslash", keyCode: 220 },
	";:": { code: "Semicolon", keyCode: 186 },
	"'\"": { code: "Quote", keyCode: 222 },
	",<": { code: "Comma", keyCode: 188 },
	".>": { code: "Period", keyCode: 190 },
	"/?": { code: "Slash", keyCode: 191 },
};

interface Key {
	key: string;
	code: string;
	windowsVirtualKeyCode: number;
	text?: string;
}

function keyDefinition(name: string, shift: boolean): Key {
	const namedCode = Object.hasOwn(NAMED_KEYS, name)
		? NAMED_KEYS[name]
		: undefined;
	if (namedCode !== undefined) {
		return {
			key: name === "Space" ? " " : name,
			code: name,
			windowsVirtualKeyCode: namedCode,
			...(name === "Enter"
				? { text: "\r" }
				: name === "Space"
					? { text: " " }
					: {}),
		};
	}
	if (/^F(?:[1-9]|1[0-2])$/.test(name)) {
		return {
			key: name,
			code: name,
			windowsVirtualKeyCode: 111 + Number(name.slice(1)),
		};
	}
	const key = name === "Plus" ? "+" : name;
	if ([...key].length !== 1) {
		throw new Error(
			`Unknown key ${name}; use a character, Enter, Tab, Escape, arrows, or a chord such as Control+a`,
		);
	}
	if (/^[a-z]$/i.test(key)) {
		const text = shift ? key.toUpperCase() : key;
		return {
			key: text,
			code: `Key${key.toUpperCase()}`,
			windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
			text,
		};
	}
	const digit = "0123456789".indexOf(key);
	const shiftedDigit = ")!@#$%^&*(".indexOf(key);
	if (digit >= 0 || shiftedDigit >= 0) {
		const number = digit >= 0 ? digit : shiftedDigit;
		const text = shift && digit >= 0 ? ")!@#$%^&*(".charAt(number) : key;
		return {
			key: text,
			code: `Digit${number}`,
			windowsVirtualKeyCode: 48 + number,
			text,
		};
	}
	for (const [characters, definition] of Object.entries(PUNCTUATION)) {
		if (!characters.includes(key)) continue;
		const text = shift ? characters.charAt(1) : key;
		return {
			key: text,
			code: definition.code,
			windowsVirtualKeyCode: definition.keyCode,
			text,
		};
	}
	return { key, code: "", windowsVirtualKeyCode: 0, text: key };
}

export function parseKeyChord(chord: string): {
	modifiers: Modifier[];
	key: Key;
} {
	const parts =
		chord === "+" ? ["Plus"] : chord.split("+").map((part) => part.trim());
	const name = parts.pop();
	if (!name) throw new Error("Missing key; use Plus for + in a chord");
	const modifiers: Modifier[] = [];
	for (const part of parts) {
		const modifier = ALIASES[part] ?? part;
		if (!Object.hasOwn(MODIFIERS, modifier))
			throw new Error(
				`Unknown modifier ${part}; use Control, Alt, Shift, or Meta`,
			);
		const valid = modifier as Modifier;
		if (modifiers.includes(valid)) throw new Error(`Repeated modifier ${part}`);
		modifiers.push(valid);
	}
	return { modifiers, key: keyDefinition(name, modifiers.includes("Shift")) };
}

export async function pressKey(
	cdp: CdpConnection,
	sessionId: string,
	chord: string,
	signal?: AbortSignal,
): Promise<string> {
	const { modifiers, key } = parseKeyChord(chord);
	const held: Array<{ key: Key; bit: number }> = [];
	let mask = 0;
	let failure: unknown;
	try {
		for (const modifier of modifiers) {
			signal?.throwIfAborted();
			const bit = MODIFIERS[modifier];
			const keyCode = { Alt: 18, Control: 17, Meta: 91, Shift: 16 }[modifier];
			const modifierKey = {
				key: modifier,
				code: `${modifier}Left`,
				windowsVirtualKeyCode: keyCode,
			};
			mask |= bit;
			held.push({ key: modifierKey, bit });
			await cdp.send(
				"Input.dispatchKeyEvent",
				{ ...modifierKey, type: "rawKeyDown", modifiers: mask },
				sessionId,
				signal,
			);
		}
		signal?.throwIfAborted();
		held.push({ key, bit: 0 });
		const { text, ...identity } = key;
		const insertsText = text !== undefined && (mask & ~MODIFIERS.Shift) === 0;
		await cdp.send(
			"Input.dispatchKeyEvent",
			{
				...identity,
				type: insertsText ? "keyDown" : "rawKeyDown",
				modifiers: mask,
				...(insertsText ? { text } : {}),
			},
			sessionId,
			signal,
		);
	} catch (error) {
		failure = error;
	} finally {
		for (const heldKey of held.reverse()) {
			mask &= ~heldKey.bit;
			const { text: _text, ...identity } = heldKey.key;
			try {
				await cdp.send(
					"Input.dispatchKeyEvent",
					{ ...identity, type: "keyUp", modifiers: mask },
					sessionId,
				);
			} catch (error) {
				failure = failure
					? new AggregateError(
							[failure, error],
							"Key press failed; key release also failed",
						)
					: error;
			}
		}
	}
	if (failure) throw failure;
	signal?.throwIfAborted();
	return `Pressed ${chord}`;
}
