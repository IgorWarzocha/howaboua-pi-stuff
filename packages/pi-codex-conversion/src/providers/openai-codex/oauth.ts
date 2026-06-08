import { createServer, type Server } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { type OAuthDeviceCodeInfo, pollOAuthDeviceCodeFlow } from "@earendil-works/pi-ai/oauth";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
const DEVICE_CODE_TIMEOUT_SECONDS = 15 * 60;
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
function oauthSuccessHtml(message: string): string { return `<!doctype html><meta charset="utf-8"><title>Login complete</title><body>${message}</body>`; }
function oauthErrorHtml(message: string): string { return `<!doctype html><meta charset="utf-8"><title>Login error</title><body>${message}</body>`; }
export const OPENAI_CODEX_NATIVE_SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke";

type OAuthCredentials = { access: string; refresh: string; expires: number; accountId: string };
type OAuthCallbacks = Parameters<NonNullable<ProviderConfig["oauth"]>["login"]>[0];

function getCallbackHost(): string { return process.env["PI_OAUTH_CALLBACK_HOST"] || "127.0.0.1"; }
function base64Url(bytes: Buffer): string { return bytes.toString("base64url"); }
function createState(): string { return randomBytes(16).toString("hex"); }
async function createPkce(): Promise<{ verifier: string; challenge: string }> {
	const verifier = base64Url(randomBytes(32));
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

function decodeJwt(token: string): Record<string, unknown> | null {
	try { return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")); } catch { return null; }
}

export function getOpenAICodexAccountId(accessToken: string): string | null {
	const auth = decodeJwt(accessToken)?.[JWT_CLAIM_PATH] as { chatgpt_account_id?: unknown } | undefined;
	return typeof auth?.chatgpt_account_id === "string" && auth.chatgpt_account_id ? auth.chatgpt_account_id : null;
}

function compactCodeState(code: string | null | undefined, state?: string | null | undefined): { code?: string; state?: string } {
	return { ...(code ? { code } : {}), ...(state ? { state } : {}) };
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
	const value = input.trim();
	if (!value) return {};
	try {
		const url = new URL(value);
		return compactCodeState(url.searchParams.get("code"), url.searchParams.get("state"));
	} catch {}
	if (value.includes("#")) {
		const [code, state] = value.split("#", 2);
		return compactCodeState(code, state);
	}
	if (value.includes("code=")) {
		const params = new URLSearchParams(value);
		return compactCodeState(params.get("code"), params.get("state"));
	}
	return { code: value };
}

export async function createOpenAICodexNativeAuthorizationFlow(originator = "pi"): Promise<{ verifier: string; state: string; url: string }> {
	const { verifier, challenge } = await createPkce();
	const state = createState();
	const url = new URL(AUTHORIZE_URL);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", CLIENT_ID);
	url.searchParams.set("redirect_uri", REDIRECT_URI);
	url.searchParams.set("scope", OPENAI_CODEX_NATIVE_SCOPE);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("id_token_add_organizations", "true");
	url.searchParams.set("codex_cli_simplified_flow", "true");
	url.searchParams.set("originator", originator);
	return { verifier, state, url: url.toString() };
}

async function tokenRequest(body: URLSearchParams, operation: string, signal?: AbortSignal): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: signal ?? null });
	if (!response.ok) throw new Error(`OpenAI Codex token ${operation} failed (${response.status}): ${await response.text().catch(() => response.statusText)}`);
	const json = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
	if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") throw new Error(`OpenAI Codex token ${operation} response missing fields: ${JSON.stringify(json)}`);
	const accountId = getOpenAICodexAccountId(json.access_token);
	if (!accountId) throw new Error("Failed to extract accountId from OpenAI Codex token");
	return { access: json.access_token, refresh: json.refresh_token, expires: Date.now() + json.expires_in * 1000, accountId };
}

async function exchangeAuthorizationCode(code: string, verifier: string, redirectUri: string, signal?: AbortSignal): Promise<OAuthCredentials> {
	return tokenRequest(new URLSearchParams({ grant_type: "authorization_code", client_id: CLIENT_ID, code, code_verifier: verifier, redirect_uri: redirectUri }), "exchange", signal);
}

function startLocalOAuthServer(state: string): Promise<{ close: () => void; cancelWait: () => void; waitForCode: () => Promise<{ code: string } | null> }> {
	let server: Server;
	let settleWait: ((value: { code: string } | null) => void) | undefined;
	const waitForCodePromise = new Promise<{ code: string } | null>((resolve) => { settleWait = resolve; });
	server = createServer((req, res) => {
		try {
			const url = new URL(req.url || "", "http://localhost");
			if (url.pathname !== "/auth/callback") { res.statusCode = 404; res.end(oauthErrorHtml("Callback route not found.")); return; }
			if (url.searchParams.get("state") !== state) { res.statusCode = 400; res.end(oauthErrorHtml("State mismatch.")); return; }
			const code = url.searchParams.get("code");
			if (!code) { res.statusCode = 400; res.end(oauthErrorHtml("Missing authorization code.")); return; }
			res.statusCode = 200; res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(oauthSuccessHtml("OpenAI authentication completed. You can close this window.")); settleWait?.({ code });
		} catch { res.statusCode = 500; res.end(oauthErrorHtml("Internal error while processing OAuth callback.")); }
	});
	return new Promise((resolve) => {
		server.listen(1455, getCallbackHost(), () => resolve({ close: () => server.close(), cancelWait: () => settleWait?.(null), waitForCode: () => waitForCodePromise }))
			.on("error", () => resolve({ close: () => {}, cancelWait: () => {}, waitForCode: async () => null }));
	});
}

async function loginBrowser(callbacks: OAuthCallbacks): Promise<OAuthCredentials> {
	const { verifier, state, url } = await createOpenAICodexNativeAuthorizationFlow("pi");
	const server = await startLocalOAuthServer(state);
	callbacks.onAuth({ url, instructions: "A browser window should open. Complete login to finish." });
	try {
		let manualInput: string | undefined;
		let manualError: Error | undefined;
		if (callbacks.onManualCodeInput) {
			void callbacks.onManualCodeInput().then((value) => { manualInput = value; server.cancelWait(); }).catch((error) => {
				manualError = error instanceof Error ? error : new Error(String(error));
				server.cancelWait();
			});
		}
		let code = (await server.waitForCode())?.code;
		if (manualError) throw manualError;
		if (!code && manualInput) {
			const parsed = parseAuthorizationInput(manualInput);
			if (parsed.state && parsed.state !== state) throw new Error("State mismatch");
			code = parsed.code;
		}
		if (!code) {
			const input = await callbacks.onPrompt({ message: "Paste the authorization code (or full redirect URL):" });
			const parsed = parseAuthorizationInput(input);
			if (parsed.state && parsed.state !== state) throw new Error("State mismatch");
			code = parsed.code;
		}
		if (!code) throw new Error("Missing authorization code");
		return exchangeAuthorizationCode(code, verifier, REDIRECT_URI, callbacks.signal);
	} finally { server.close(); }
}

async function loginDeviceCode(callbacks: OAuthCallbacks): Promise<OAuthCredentials> {
	const response = await fetch(DEVICE_USER_CODE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: CLIENT_ID }), signal: callbacks.signal ?? null });
	if (!response.ok) throw new Error(`OpenAI Codex device code request failed with status ${response.status}: ${await response.text().catch(() => response.statusText)}`);
	const json = await response.json() as { device_auth_id?: string; user_code?: string; interval?: number | string };
	const intervalSeconds = typeof json.interval === "string" ? Number(json.interval.trim()) : json.interval;
	if (!json.device_auth_id || !json.user_code || typeof intervalSeconds !== "number" || !Number.isFinite(intervalSeconds)) throw new Error(`Invalid OpenAI Codex device code response: ${JSON.stringify(json)}`);
	callbacks.onDeviceCode({ userCode: json.user_code, verificationUri: DEVICE_VERIFICATION_URI, intervalSeconds, expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS } satisfies OAuthDeviceCodeInfo);
	const code = await pollOAuthDeviceCodeFlow({
		intervalSeconds,
		expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS,
		signal: callbacks.signal ?? new AbortController().signal,
		poll: async () => {
			const pollResponse = await fetch(DEVICE_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_auth_id: json.device_auth_id, user_code: json.user_code }), signal: callbacks.signal ?? null });
			if (pollResponse.ok) {
				const pollJson = await pollResponse.json() as { authorization_code?: string; code_verifier?: string };
				return pollJson.authorization_code && pollJson.code_verifier ? { status: "complete", value: pollJson } : { status: "failed", message: `Invalid OpenAI Codex device auth token response: ${JSON.stringify(pollJson)}` };
			}
			if (pollResponse.status === 403 || pollResponse.status === 404) return { status: "pending" };
			return { status: "failed", message: `OpenAI Codex device auth failed with status ${pollResponse.status}: ${await pollResponse.text().catch(() => pollResponse.statusText)}` };
		},
	});
	if (!code.authorization_code || !code.code_verifier) throw new Error("Invalid OpenAI Codex device auth token response");
	return exchangeAuthorizationCode(code.authorization_code, code.code_verifier, DEVICE_REDIRECT_URI, callbacks.signal);
}

export const openaiCodexNativeOAuthProvider: NonNullable<ProviderConfig["oauth"]> & { usesCallbackServer: true } = {
	name: "ChatGPT Plus/Pro (Codex Subscription)",
	usesCallbackServer: true,
	async login(callbacks) {
		const method = await callbacks.onSelect({ message: "Select OpenAI Codex login method:", options: [{ id: "browser", label: "Browser login (default)" }, { id: "device_code", label: "Device code login (headless)" }] });
		if (method === "device_code") return loginDeviceCode(callbacks);
		if (method && method !== "browser") throw new Error(`Unknown OpenAI Codex login method: ${method}`);
		return loginBrowser(callbacks);
	},
	refreshToken(credentials) { return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: credentials.refresh, client_id: CLIENT_ID }), "refresh"); },
	getApiKey(credentials) { return credentials.access; },
};
