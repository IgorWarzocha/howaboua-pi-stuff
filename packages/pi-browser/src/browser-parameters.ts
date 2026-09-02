import { StringEnum } from "@earendil-works/pi-ai";
import { type TSchema, Type } from "typebox";

export function browserParameters(hosts: readonly string[]) {
	const route: Record<string, TSchema> =
		hosts.length > 0
			? {
					host: Type.Optional(
						StringEnum(hosts, { description: "Configured browser host" }),
					),
				}
			: {};
	const request = (properties: Record<string, TSchema>) =>
		Type.Object({ ...route, ...properties }, { additionalProperties: false });
	const refId = Type.String({
		minLength: 1,
		description: "Tab ref_id returned by tabs",
	});
	const elementId = Type.Integer({
		minimum: 1,
		description: "Element id returned by open or find",
	});
	const responseLength = StringEnum(["short", "medium", "long"] as const);
	const handle = Type.String({
		minLength: 1,
		description: "Continuation handle returned by browser",
	});
	return Type.Union([
		request({ action: StringEnum(["help", "start"] as const) }),
		request({
			action: Type.Literal("tabs"),
			query: Type.Optional(Type.String({ minLength: 1 })),
			offset: Type.Optional(Type.Integer({ minimum: 0 })),
		}),
		request({
			action: Type.Literal("open"),
			ref_id: refId,
			lineno: Type.Optional(Type.Integer({ minimum: 1 })),
			response_length: Type.Optional(responseLength),
		}),
		request({
			action: Type.Literal("open"),
			url: Type.String({ minLength: 1 }),
		}),
		request({
			action: Type.Literal("find"),
			ref_id: refId,
			pattern: Type.String({ minLength: 1 }),
			lineno: Type.Optional(Type.Integer({ minimum: 1 })),
			response_length: Type.Optional(responseLength),
		}),
		request({ action: Type.Literal("click"), ref_id: refId, id: elementId }),
		request({
			action: Type.Literal("click"),
			ref_id: refId,
			selector: Type.String({ minLength: 1 }),
		}),
		request({
			action: Type.Literal("click"),
			ref_id: refId,
			x: Type.Number(),
			y: Type.Number(),
		}),
		request({
			action: Type.Literal("type"),
			ref_id: refId,
			id: Type.Optional(elementId),
			text: Type.String({ minLength: 1 }),
		}),
		request({
			action: StringEnum(["screenshot", "html"] as const),
			ref_id: refId,
		}),
		request({
			action: StringEnum(["screenshot", "html"] as const),
			ref_id: refId,
			id: elementId,
		}),
		request({
			action: StringEnum(["screenshot", "html"] as const),
			ref_id: refId,
			selector: Type.String({ minLength: 1 }),
		}),
		request({
			action: Type.Literal("navigate"),
			ref_id: refId,
			url: Type.String({ minLength: 1 }),
		}),
		request({
			action: Type.Literal("evaluate"),
			ref_id: refId,
			expression: Type.String({ minLength: 1 }),
		}),
		request({ action: Type.Literal("network"), ref_id: refId }),
		request({
			action: Type.Literal("load_all"),
			ref_id: refId,
			selector: Type.String({ minLength: 1 }),
			interval_ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 60_000 })),
		}),
		request({
			action: Type.Literal("raw"),
			ref_id: refId,
			method: Type.String({ minLength: 1 }),
			params: Type.Optional(Type.Object({}, { additionalProperties: true })),
		}),
		request({
			action: Type.Literal("read_result"),
			handle,
			offset: Type.Optional(Type.Integer({ minimum: 0 })),
		}),
		request({ action: Type.Literal("discard_result"), handle }),
		request({
			action: Type.Literal("stop"),
			ref_id: Type.Optional(refId),
		}),
	]);
}
