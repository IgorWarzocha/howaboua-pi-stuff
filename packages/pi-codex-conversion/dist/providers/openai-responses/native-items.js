export function encryptedOutputFromWebRunLike(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const encryptedOutput = value["encrypted_output"];
    return typeof encryptedOutput === "string" && encryptedOutput.trim() ? encryptedOutput : undefined;
}
export function encryptedWebRunOutputFromDetails(details) {
    if (!details || typeof details !== "object")
        return undefined;
    const record = details;
    return encryptedOutputFromWebRunLike(record["webRun"])
        ?? encryptedOutputFromWebRunLike(record["pathTool"]?.["webRun"]);
}
export function isImageGenerationCallBlock(block) {
    return block.type === "image_generation_call" && typeof block.item === "object" && block.item !== null && block.item["type"] === "image_generation_call";
}
export function isWebSearchCallBlock(block) {
    return block.type === "web_search_call" && typeof block.item === "object" && block.item !== null && block.item["type"] === "web_search_call";
}
export function sanitizeImageGenerationCallItem(item) {
    if (!item || typeof item !== "object")
        return undefined;
    const candidate = item;
    if (candidate["type"] !== "image_generation_call")
        return undefined;
    if (typeof candidate["id"] !== "string" || candidate["id"] === "")
        return undefined;
    if (typeof candidate["status"] !== "string" || candidate["status"] === "")
        return undefined;
    if (!(typeof candidate["result"] === "string" || candidate["result"] === null))
        return undefined;
    return {
        type: "image_generation_call",
        id: candidate["id"],
        status: candidate["status"],
        result: candidate["result"],
        ...(typeof candidate["revised_prompt"] === "string" ? { revised_prompt: candidate["revised_prompt"] } : {}),
    };
}
export function sanitizeWebSearchCallItem(item) {
    if (!item || typeof item !== "object")
        return undefined;
    const candidate = item;
    if (candidate["type"] !== "web_search_call")
        return undefined;
    if (typeof candidate["id"] !== "string" || candidate["id"] === "")
        return undefined;
    return {
        type: "web_search_call",
        id: candidate["id"],
        ...(typeof candidate["status"] === "string" ? { status: candidate["status"] } : {}),
        ...(candidate["action"] !== undefined ? { action: candidate["action"] } : {}),
        ...(candidate["results"] !== undefined ? { results: candidate["results"] } : {}),
    };
}
export function imageDetailForResponses(block) {
    const detail = block && typeof block === "object" ? block["detail"] : undefined;
    return detail === "high" || detail === "original" ? detail : "auto";
}
