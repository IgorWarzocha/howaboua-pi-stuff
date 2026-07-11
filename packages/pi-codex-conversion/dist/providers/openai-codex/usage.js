function getServiceTierCostMultiplier(model, serviceTier) {
    switch (serviceTier) {
        case "flex":
            return 0.5;
        case "priority":
            return model.id === "gpt-5.5" ? 2.5 : 2;
        default:
            return 1;
    }
}
export function applyServiceTierPricing(usage, serviceTier, model) {
    const multiplier = getServiceTierCostMultiplier(model, serviceTier);
    if (multiplier === 1)
        return;
    usage.cost.input *= multiplier;
    usage.cost.output *= multiplier;
    usage.cost.cacheRead *= multiplier;
    usage.cost.cacheWrite *= multiplier;
    usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}
export function resolveCodexServiceTier(responseServiceTier, requestServiceTier) {
    if (responseServiceTier === "default" && (requestServiceTier === "flex" || requestServiceTier === "priority")) {
        return requestServiceTier;
    }
    return responseServiceTier ?? requestServiceTier;
}
export function finalizeUsage(output) {
    output.usage.cost.total = output.usage.cost.input + output.usage.cost.output + output.usage.cost.cacheRead + output.usage.cost.cacheWrite;
}
