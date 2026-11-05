import { StringEnum as PiStringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// Pi 1.5 enums carry pi-schema types; retain inference inside TypeBox-built schemas.
export function StringEnum<T extends readonly string[]>(values: T) {
	return Type.Unsafe<T[number]>(PiStringEnum(values));
}
