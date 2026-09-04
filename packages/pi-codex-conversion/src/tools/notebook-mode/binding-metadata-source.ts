import {
	MAX_PROJECT_DESCRIPTION_BYTES,
	MAX_PROJECT_USAGE_BYTES,
	MAX_PROJECT_USAGE_LINES,
} from "./project-state-format.ts";

export const BINDING_METADATA_READER_SOURCE = `
  const __readBindingMetadata = (__value) => {
    if (__value === null || (typeof __value !== "object" && typeof __value !== "function")) return {};
    const __metadata = {};
    for (const [__key, __max, __multiline, __lines] of [
      ["description", ${MAX_PROJECT_DESCRIPTION_BYTES}, false, 1],
      ["usage", ${MAX_PROJECT_USAGE_BYTES}, true, ${MAX_PROJECT_USAGE_LINES}],
    ]) {
      const __descriptor = Object.getOwnPropertyDescriptor(__value, __key);
      if (!__descriptor || !("value" in __descriptor) || typeof __descriptor.value !== "string") continue;
      const __text = __descriptor.value;
      if (!__text || new TextEncoder().encode(__text).byteLength > __max || __text.includes("\\r")) continue;
      const __textLines = __text.split("\\n");
      if (__textLines.length > __lines) continue;
      let __valid = true;
      for (const __character of __text) {
        const __codePoint = __character.codePointAt(0);
        if ((__codePoint < 0x20 && __codePoint !== 0x0a) || __codePoint === 0x7f || !__multiline && __codePoint === 0x0a) {
          __valid = false;
          break;
        }
      }
      if (__valid) __metadata[__key] = __text;
    }
    return __metadata;
  };
`;

export const BINDING_METADATA_RESTORE_SOURCE = `
	const __applyMetadata = (__value, __entry) => {
	  if (__value === null || (typeof __value !== "object" && typeof __value !== "function")) return;
	  for (const __key of ["description", "usage"]) {
	    if (typeof __entry[__key] !== "string") continue;
	    try {
	      Object.defineProperty(__value, __key, {
	        value: __entry[__key],
	        writable: true,
	        configurable: true,
	        enumerable: true,
	      });
	    } catch {}
	  }
	};
`;
