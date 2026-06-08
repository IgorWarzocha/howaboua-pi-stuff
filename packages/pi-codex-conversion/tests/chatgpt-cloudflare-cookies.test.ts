import test from "node:test";
import assert from "node:assert/strict";
import {
	attachChatGptCloudflareCookies,
	chatGptCloudflareCookieHeader,
	clearChatGptCloudflareCookiesForTests,
	isAllowedChatGptHost,
	isAllowedCloudflareCookieName,
	storeChatGptCloudflareCookies,
} from "../src/tools/chatgpt-cloudflare-cookies.ts";

test("recognizes ChatGPT hosts without suffix tricks", () => {
	for (const host of ["chatgpt.com", "foo.chatgpt.com", "chat.openai.com", "chatgpt-staging.com", "api.chatgpt-staging.com"]) {
		assert.equal(isAllowedChatGptHost(host), true);
	}
	for (const host of ["evilchatgpt.com", "chatgpt.com.evil.example", "api.openai.com", "foo.chat.openai.com"]) {
		assert.equal(isAllowedChatGptHost(host), false);
	}
});

test("allows only Cloudflare infrastructure cookie names", () => {
	for (const name of ["__cf_bm", "_cfuvid", "cf_clearance", "cf_chl_2"]) assert.equal(isAllowedCloudflareCookieName(name), true);
	for (const name of ["__Secure-next-auth.session-token", "oai-did", "session"]) assert.equal(isAllowedCloudflareCookieName(name), false);
});

test("stores and attaches only Cloudflare cookies for ChatGPT hosts", () => {
	clearChatGptCloudflareCookiesForTests();
	const headers = new Headers();
	headers.append("set-cookie", "_cfuvid=visitor; Path=/; Secure; HttpOnly");
	headers.append("set-cookie", "cf_clearance=clearance; Path=/; Secure; HttpOnly");
	headers.append("set-cookie", "__Secure-next-auth.session-token=secret; Path=/; Secure; HttpOnly");

	storeChatGptCloudflareCookies("https://chatgpt.com/backend-api/alpha/search", headers);

	assert.equal(chatGptCloudflareCookieHeader("https://chatgpt.com/backend-api/alpha/search"), "_cfuvid=visitor; cf_clearance=clearance");
	assert.equal(chatGptCloudflareCookieHeader("https://api.openai.com/v1/responses"), undefined);

	const outgoing = new Headers();
	attachChatGptCloudflareCookies("https://chatgpt.com/backend-api/alpha/search", outgoing);
	assert.equal(outgoing.get("cookie"), "_cfuvid=visitor; cf_clearance=clearance");
});

test("ignores cookies from non-ChatGPT hosts", () => {
	clearChatGptCloudflareCookiesForTests();
	const headers = new Headers({ "set-cookie": "cf_clearance=clearance; Path=/; Secure; HttpOnly" });
	storeChatGptCloudflareCookies("https://api.openai.com/v1/responses", headers);
	assert.equal(chatGptCloudflareCookieHeader("https://chatgpt.com/backend-api/alpha/search"), undefined);
});
