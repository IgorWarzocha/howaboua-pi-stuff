import { z } from "zod";

const nameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const guestPath = z
	.string()
	.startsWith("/")
	.refine((s) => !s.includes("\0"));
export const profiles = {
	tiny: { cpus: 1, memoryGiB: 2 },
	small: { cpus: 2, memoryGiB: 4 },
	medium: { cpus: 4, memoryGiB: 8 },
	large: { cpus: 8, memoryGiB: 16 },
	xlarge: { cpus: 16, memoryGiB: 32 },
} as const;
const serviceSchema = z.strictObject({
	command: z.string().min(1),
	cwd: guestPath.default("/workspace"),
	port: z.number().int().min(1).max(65535),
	env: z
		.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string())
		.default({})
		.refine(
			(env) => !("PORT" in env || "PUBLIC_URL" in env),
			"PORT and PUBLIC_URL are managed",
		),
	health: z.string().startsWith("/").optional(),
	portal: z.boolean().default(false),
	timeoutMs: z.number().int().min(100).max(120000).default(30000),
});
export const configSchema = z
	.strictObject({
		version: z.literal(1).default(1),
		profile: z
			.enum(["tiny", "small", "medium", "large", "xlarge"])
			.default("small"),
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
		services: z.record(nameSchema, serviceSchema).default({}),
	})
	.refine(
		(c) =>
			new Set(Object.values(c.services).map((s) => s.port)).size ===
			Object.keys(c.services).length,
		"Service ports must be unique",
	);
export type OrbConfig = z.infer<typeof configSchema>;
export type Service = z.infer<typeof serviceSchema>;
export const commandOutcomeSchema = z.discriminatedUnion("state", [
	z.strictObject({ state: z.literal("exited"), exitCode: z.number().int() }),
	z.strictObject({ state: z.literal("timed-out") }),
]);
const identity = { name: nameSchema };
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
		cwd: guestPath.optional(),
		timeoutMs: z.number().int().min(100).max(120000).default(30000),
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
		service: nameSchema.optional(),
	}),
	z.strictObject({
		action: z.literal("logs"),
		...identity,
		service: nameSchema.optional(),
		lines: z.number().int().min(1).max(500).default(100),
	}),
]);
export type Action = z.infer<typeof actionSchema>;
export const recordSchema = z.strictObject({
	version: z.literal(1),
	name: nameSchema,
	config: configSchema,
	createdAt: z.string(),
	template: nameSchema.optional(),
});
export type OrbRecord = z.infer<typeof recordSchema>;
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
	portals: z.record(z.string(), z.string()).optional(),
	persistence: z.literal("disk-only").optional(),
	startupError: z.string().optional(),
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
		list: "kind?: instances|templates",
		prepare:
			"name, config: host YAML path. Run setup and save reusable disk template, without services or credentials",
		create:
			"name, config: host YAML path OR template: name. Fresh independent disk, starts services",
		start:
			"name. Reopen stopped instance from disk, rerun resume hooks and services. Running is unchanged",
		stop: "name. Stop processes and preserve disk. No memory/process resume",
		inspect: "name",
		shell:
			"name, user?: root. Fresh ephemeral localhost SSH command for the user. No forwarded host credentials. Requires guest sshd and host ssh-keygen",
		exec: "name, cmd, cwd?, timeoutMs?: 30000 (max 120000). Guest shell, not host. Timeout cancels command",
		read: "name, path: guest absolute path. Text up to 64 KiB",
		write: "name, path: guest absolute path, content. Parent must exist",
		services:
			"name, op: ensure|status|restart|stop, service?: declared name (omit for all)",
		logs: "name, service?: name (omit for controller log), lines?: 100 (max 500)",
		destroy:
			"name, confirm: same name, kind?: instances|templates. Irreversibly removes owned disk and logs",
	},
	config: {
		version: 1,
		profile: "small",
		resources: "optional {cpus, memoryGiB}",
		diskGiB: 60,
		image: "optional Gondolin asset directory, relative to YAML",
		workspace: "/workspace",
		setup: ["guest shell commands, fresh creation only"],
		resume: ["guest shell commands, every start"],
		network: { allowedHosts: [] },
		services: {
			web: {
				command: "python3 -m http.server $PORT --bind 127.0.0.1",
				cwd: "/workspace",
				port: 8000,
				portal: true,
				health: "/",
				env: {},
				timeoutMs: 30000,
			},
		},
	},
	profiles,
	boundaries:
		"Linux KVM or macOS HVF with QEMU. Sparse virtual disk capacity, not host quota. Unauthenticated localhost HTTP/WebSocket portals, not public or remote-host links. No host mounts/auth. Pi exit leaves instances running, explicit stop/destroy required. Templates must contain no secrets. Guest Pi requires compatible custom image, user completes fresh login. Empty network allowlist blocks outbound HTTP",
};
