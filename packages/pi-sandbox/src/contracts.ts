import { z } from "zod";

export function prepareSandboxInput(value: unknown): { input: string } {
	if (value === undefined) return { input: "help" };
	if (typeof value === "string") return { input: value };
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		if (Object.keys(value).length === 0) return { input: "help" };
		if ("input" in value && typeof value.input === "string")
			return { ...value, input: value.input };
		if (!("input" in value)) return { input: JSON.stringify(value) };
	}
	throw new Error("Send help, an action object or a JSON string");
}

const nameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const guestPath = z
	.string()
	.startsWith("/")
	.refine((s) => !s.includes("\0"));
const serviceName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
const cwd = z
	.string()
	.refine((s) => !s.includes("\0"))
	.default(".");
const previewUrl = z
	.string()
	.refine((s) => {
		if (s.startsWith("/") && !s.startsWith("//")) return true;
		try {
			return ["http:", "https:"].includes(new URL(s).protocol);
		} catch {
			return false;
		}
	})
	.refine(
		(s) => !s.includes("$AMP_USER_EMAIL"),
		"Amp identity placeholders are unavailable locally",
	);
const previewText = z
	.string()
	.refine(
		(s) => !s.includes("$AMP_USER_EMAIL"),
		"Amp identity placeholders are unavailable locally",
	);
const linkSchema = z.strictObject({
	url: previewUrl,
	title: previewText.min(1),
	description: previewText.optional(),
});
const previewSchema = z.union([
	z.boolean(),
	z.strictObject({
		url: previewUrl.default("/"),
		title: previewText.optional(),
		description: previewText.optional(),
	}),
]);
export const profiles = {
	tiny: { cpus: 1, memoryGiB: 2 },
	small: { cpus: 2, memoryGiB: 4 },
	medium: { cpus: 4, memoryGiB: 8 },
	large: { cpus: 8, memoryGiB: 16 },
	xlarge: { cpus: 16, memoryGiB: 32 },
} as const;
const defaultProfile = "small";
const serviceSchema = z.strictObject({
	command: z.string().min(1),
	cwd,
	port: z.number().int().min(1).max(65535).optional(),
	env: z
		.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string())
		.default({})
		.refine(
			(env) =>
				!("PORT" in env || "PUBLIC_URL" in env || "AMP_THREAD_ID" in env),
			"PORT and PUBLIC_URL are managed; Amp identity is unavailable locally",
		),
	health: z
		.union([z.string().startsWith("/"), z.literal("process")])
		.optional(),
	preview: previewSchema.default(false),
	previews: z
		.array(
			z.union([
				linkSchema,
				z.strictObject({
					folder: z.string().min(1),
					links: z.array(linkSchema).min(1),
				}),
			]),
		)
		.default([])
		.refine((links) => {
			const folders = links
				.filter((link) => "folder" in link)
				.map((link) => link.folder);
			return new Set(folders).size === folders.length;
		}, "Preview folder names must be unique"),
	platforms: z
		.array(z.enum(["linux", "darwin"]))
		.min(1)
		.optional(),
	review: z.literal(false).optional(),
	timeoutMs: z.number().int().min(100).max(120000).default(30000),
});
export const configSchema = z
	.strictObject({
		version: z.literal(1).default(1),
		profile: z
			.enum(["tiny", "small", "medium", "large", "xlarge"])
			.default(defaultProfile),
		resources: z
			.strictObject({
				cpus: z.number().int().positive(),
				memoryGiB: z.number().positive(),
			})
			.optional(),
		diskGiB: z.number().int().min(2).default(60),
		image: z.string().min(1).optional(),
		workspace: guestPath.default("/workspace"),
		setup: z.array(z.string().min(1)).default([]),
		resume: z.array(z.string().min(1)).default([]),
		network: z
			.strictObject({ allowedHosts: z.array(z.string().min(1)).default([]) })
			.default({ allowedHosts: [] }),
		services: z.record(serviceName, serviceSchema).default({}),
	})
	.refine(
		(c) =>
			new Set(
				Object.values(c.services).flatMap((s) => (s.port ? [s.port] : [])),
			).size === Object.values(c.services).filter((s) => s.port).length,
		"Service ports must be unique",
	);
export type SandboxConfig = z.infer<typeof configSchema>;
export type Service = z.infer<typeof serviceSchema>;
export const commandOutcomeSchema = z.discriminatedUnion("state", [
	z.strictObject({ state: z.literal("exited"), exitCode: z.number().int() }),
	z.strictObject({ state: z.literal("timed-out") }),
]);
const identity = { name: nameSchema };
const waitMs = z.number().int().min(0).max(60000).default(10000);
export const actionSchema = z.discriminatedUnion("action", [
	z.strictObject({
		action: z.literal("list"),
		kind: z.enum(["instances", "templates"]).default("instances"),
	}),
	z.strictObject({
		action: z.literal("prepare"),
		...identity,
		config: z.string().min(1),
	}),
	z
		.strictObject({
			action: z.literal("create"),
			...identity,
			config: z.string().optional(),
			template: nameSchema.optional(),
		})
		.refine(
			(a) => Number(!!a.config) + Number(!!a.template) === 1,
			"Supply config or template",
		),
	z.strictObject({ action: z.enum(["start", "stop", "inspect"]), ...identity }),
	z.strictObject({
		action: z.literal("shell"),
		...identity,
		user: z
			.string()
			.regex(/^[a-z_][a-z0-9_-]{0,31}$/)
			.default("root"),
	}),
	z.strictObject({
		action: z.literal("destroy"),
		...identity,
		kind: z.enum(["instances", "templates"]).default("instances"),
		confirm: nameSchema,
	}),
	z.strictObject({
		action: z.literal("exec"),
		...identity,
		cmd: z.string().min(1),
		cwd: cwd.optional(),
		timeoutMs: waitMs,
	}),
	z.strictObject({
		action: z.literal("exec-status"),
		...identity,
		pid: z.string().uuid(),
		timeoutMs: waitMs,
	}),
	z.strictObject({
		action: z.literal("exec-kill"),
		...identity,
		pid: z.string().uuid(),
	}),
	z.strictObject({ action: z.literal("read"), ...identity, path: guestPath }),
	z.strictObject({
		action: z.literal("write"),
		...identity,
		path: guestPath,
		content: z
			.string()
			.max(1048576)
			.refine((s) => Buffer.byteLength(s) <= 1048576, "Text exceeds 1 MiB"),
	}),
	z.strictObject({
		action: z.literal("services"),
		...identity,
		op: z.enum(["ensure", "status", "restart", "stop"]),
		service: serviceName.optional(),
	}),
	z.strictObject({
		action: z.literal("service-start"),
		...identity,
		service: serviceName,
		title: previewText.optional(),
		description: previewText.optional(),
		...serviceSchema.shape,
	}),
	z.strictObject({
		action: z.literal("preview"),
		...identity,
		port: z.number().int().min(1).max(65535),
		title: z.string().optional(),
		description: z.string().optional(),
	}),
	z.strictObject({
		action: z.literal("logs"),
		...identity,
		service: serviceName.optional(),
		lines: z.number().int().min(1).max(500).default(100),
	}),
]);
export const agentActionSchema = actionSchema.refine(
	(action) => action.action !== "shell",
	"Guest terminal handoff: user-only /sandbox",
);
export type Action = z.infer<typeof actionSchema>;
export const recordSchema = z.strictObject({
	version: z.literal(1),
	name: nameSchema,
	config: configSchema,
	createdAt: z.string(),
	template: nameSchema.optional(),
});
export type SandboxRecord = z.infer<typeof recordSchema>;
export const statusSchema = z.strictObject({
	name: nameSchema,
	state: z.enum([
		"starting",
		"running",
		"stopping",
		"stopped",
		"prepared",
		"failed",
		"interrupted",
		"unavailable",
	]),
	resources: z.unknown().optional(),
	diskGiB: z.number().optional(),
	previews: z.record(z.string(), z.string()).optional(),
	persistence: z.literal("disk-only").optional(),
	startupError: z.string().optional(),
	resumePid: z
		.union([z.string().uuid(), z.number().int().positive()])
		.optional(),
	recovery: z.string().optional(),
});
export const inspectionSchema = z.object({
	name: nameSchema,
	status: statusSchema,
});
export const replySchema = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true), result: z.unknown() }),
	z.object({ ok: z.literal(false), error: z.string() }),
]);
export const HELP = {
	actions: {
		list: "kind?: instances (default)|templates (prepared disks)",
		prepare:
			"name, config: host YAML path. Run setup, save reusable disk. No declared services started",
		create:
			"name, exactly one of config: host YAML path or template: name. Fresh independent disk; starts services",
		start:
			"name. Reopen disk, run resume hooks and services. No change if running",
		stop: "name. Disk-only checkpoint, then stop VM",
		inspect: "name. State, assigned CPU/RAM, disk and preview links",
		exec: "name, cmd, cwd?: workspace-relative, timeoutMs?. If running, use pid with exec-status or exec-kill",
		"exec-status": "name, pid, timeoutMs?. Return new output",
		"exec-kill": "name, pid. Stop command process group",
		read: "name, path: guest absolute path. Truncated → use exec for needed lines",
		write: "name, path: guest absolute path, content. Parent must exist",
		services:
			"name, op: ensure|status|restart|stop, service?: name (omit for all)",
		"service-start":
			"name, service, command, cwd?, port?, env?, preview?, title?, description?, previews?, health?, platforms?, timeoutMs?. Ad-hoc only; use services for declared names",
		preview: "name, port, title?, description?. Link a listening HTTP server",
		logs: "name, service? (omit for controller log), lines?",
		destroy:
			"name, confirm: same name, kind?: instances|templates. Irreversibly removes owned disk and logs",
	},
	config: `Default profile: ${defaultProfile} (${profiles[defaultProfile].cpus} CPUs, ${profiles[defaultProfile].memoryGiB} GiB RAM). Use inspect for an existing sandbox`,
	help: {
		"help config": "YAML, resource profiles and provisioning",
		"help services": "Guest services and previews",
	},
	commandWait:
		"Timeout ends wait only. Collect pending output before new commands. Restart invalidates handles",
	boundaries:
		"No host mounts or credential forwarding. Outbound HTTP blocked by default. Previews unauthenticated, local to VM host. Pi exit leaves sandboxes running",
};
export const HELP_TOPICS = {
	config: {
		yaml: {
			version: 1,
			profile: defaultProfile,
			services: {
				web: {
					command: "python3 -m http.server $PORT --bind 127.0.0.1",
					preview: true,
					health: "/",
				},
			},
		},
		profiles,
		resources: "resources: {cpus, memoryGiB} overrides profile",
		disk: "diskGiB is guest capacity, not a host storage quota",
		image: "image: asset directory relative to YAML. Reuse image from inspect",
		workspace: "Guest absolute path, defaults to /workspace",
		setup: "setup: guest commands on fresh disk only. 20-minute deadline",
		resume:
			"resume: guest commands on every start. inspect returns resumePid → exec-status",
		network: "network.allowedHosts: outbound HTTP allowlist, empty by default",
		requirements:
			"Guest commands and services require Python 3. No secrets in setup or templates",
	},
	services: {
		config:
			"Edit guest workspace .sandbox.yaml. ensure starts missing services; restart reloads running service",
		fields:
			"command, cwd? (workspace-relative), port? (assigned if omitted), env?, health?, preview?, previews?, platforms?, timeoutMs?",
		health:
			"Default TCP. GET path for HTTP readiness; process for liveness only",
		links:
			"preview:true or {url?,title?,description?}. previews: array of {url,title,description?} or {folder,links}. env may reference ${services.NAME.publicURL}",
		responses: "Preview responses need Content-Length or chunked framing",
	},
};
