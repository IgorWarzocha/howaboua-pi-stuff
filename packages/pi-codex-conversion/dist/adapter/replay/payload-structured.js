export function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
export function isResponsesInputContentItem(value) {
    if (!isRecord(value) || typeof value["type"] !== "string")
        return false;
    if (value["type"] === "input_text")
        return typeof value["text"] === "string";
    if (value["type"] === "input_image")
        return value["detail"] === "auto" && typeof value["image_url"] === "string";
    if (value["type"] === "encrypted_content")
        return typeof value["encrypted_content"] === "string";
    return false;
}
export function isResponsesInputMessageRole(value) {
    return value === "user" || value === "developer" || value === "system";
}
export function isPreambleRole(value) {
    return value === "developer" || value === "system";
}
export function isResponsesInputMessageItem(value) {
    if (!isRecord(value) || !isResponsesInputMessageRole(value["role"]))
        return false;
    const { content } = value;
    return typeof content === "string" || (Array.isArray(content) && content.every(isResponsesInputContentItem));
}
function cloneResponsesInputContentItem(item) {
    if (item.type === "input_text")
        return { type: "input_text", text: item.text };
    if (item.type === "encrypted_content")
        return { type: "encrypted_content", encrypted_content: item.encrypted_content };
    return { type: "input_image", detail: "auto", image_url: item.image_url };
}
export function cloneResponsesInputMessageItem(item) {
    return { role: item.role, content: typeof item.content === "string" ? item.content : item.content.map(cloneResponsesInputContentItem) };
}
export function cloneStructuredValue(value) {
    if (value === undefined || value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        return value;
    if (Array.isArray(value))
        return value.map(cloneStructuredValue);
    if (isRecord(value)) {
        const clone = {};
        for (const [key, nested] of Object.entries(value))
            clone[key] = cloneStructuredValue(nested);
        return clone;
    }
    throw new Error(`Unsupported structured value: ${typeof value}`);
}
export function cloneOpaqueCompactedWindow(compactedWindow) {
    const cloned = [];
    for (const item of compactedWindow) {
        if (!isRecord(item))
            return undefined;
        try {
            cloned.push(cloneStructuredValue(item));
        }
        catch {
            return undefined;
        }
    }
    return cloned;
}
export function cloneResponsesInputSlice(items) {
    const cloned = [];
    for (const item of items) {
        try {
            cloned.push(cloneStructuredValue(item));
        }
        catch {
            return undefined;
        }
    }
    return cloned;
}
export function areEquivalentValues(left, right) {
    if (Object.is(left, right))
        return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length)
            return false;
        for (let index = 0; index < left.length; index++) {
            if (!areEquivalentValues(left[index], right[index]))
                return false;
        }
        return true;
    }
    if (isRecord(left) || isRecord(right)) {
        if (!isRecord(left) || !isRecord(right))
            return false;
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();
        if (!areEquivalentValues(leftKeys, rightKeys))
            return false;
        for (const key of leftKeys) {
            if (!areEquivalentValues(left[key], right[key]))
                return false;
        }
        return true;
    }
    return false;
}
