import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

export const ROLE_ENV = "PI_AUTO_HARDENING_ROLE";
export const DISABLED_ENV = "PI_AUTO_HARDENING_DISABLED";
export const WORKER_ROLE = "worker";
export const RESULT_MESSAGE_TYPE = "auto-hardening-result";
export const HARDENING_PROMPT_PATH = path.join(
	PACKAGE_ROOT,
	"hardener.prompt.md",
);
export const MAX_WORKER_PASSES = 12;
export const MAX_CANDIDATES_IN_PROMPT = 30;

export const SOURCE_EXTENSIONS = new Set([
	".astro",
	".bash",
	".c",
	".cc",
	".cpp",
	".cs",
	".css",
	".ex",
	".exs",
	".go",
	".h",
	".hpp",
	".html",
	".java",
	".js",
	".jsx",
	".kt",
	".kts",
	".lua",
	".mjs",
	".php",
	".py",
	".rb",
	".rs",
	".scss",
	".sh",
	".sql",
	".svelte",
	".swift",
	".ts",
	".tsx",
	".vue",
	".zig",
]);

export const EXCLUDED_PATH_SEGMENTS = new Set([
	".cache",
	".git",
	".next",
	".output",
	"build",
	"coverage",
	"dist",
	"generated",
	"node_modules",
	"target",
	"vendor",
]);
