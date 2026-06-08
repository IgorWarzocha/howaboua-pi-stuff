export type { FreshAuthoritativePreamble } from "./payload-preamble.ts";
export { extractFreshAuthoritativePreamble } from "./payload-preamble.ts";
export {
	buildNativeReplaySegments,
	collectLiveTailMessages,
	collectReplayMessages,
	findCompactionBoundaryIndex,
	findEntriesStrictlyAfterCompactionBoundary,
	rewriteResponsesPayloadWithNativeReplay,
	serializeLiveTailToResponsesInput,
	type NativeReplayPayloadRewrite,
	type NativeReplayPayloadRewriteFailure,
	type NativeReplayPayloadRewriteFailureReason,
	type NativeReplayPayloadRewriteResult,
	type NativeReplaySegments,
	type SerializedReplaySlice,
} from "./native-replay-segments.ts";
