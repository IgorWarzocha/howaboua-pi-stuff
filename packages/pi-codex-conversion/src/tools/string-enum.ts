import { oneOf } from "@earendil-works/pi-schema";

// Keep the explicit string type for providers that require typed enums.
export function StringEnum<T extends readonly string[]>(values: T) {
	return { ...oneOf(values), type: "string" };
}
