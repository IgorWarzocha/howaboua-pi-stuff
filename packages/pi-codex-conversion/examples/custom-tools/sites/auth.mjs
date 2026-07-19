import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export async function getSitesAuth() {
  const authPath = process.env.PI_AUTH_FILE || join(
    process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
    "auth.json",
  );
  let credential;
  try {
    const stored = JSON.parse(await readFile(authPath, "utf8"));
    credential = stored?.["openai-codex"];
  } catch (error) {
    throw new Error(`Could not read Pi authentication from ${authPath}: ${error.message}`);
  }
  if (typeof credential?.access !== "string" || !credential.access) {
    throw new Error("OpenAI Codex OAuth is not configured in Pi");
  }
  if (Number.isFinite(credential.expires) && credential.expires <= Date.now()) {
    throw new Error("Pi's OpenAI Codex OAuth token is expired; run a Codex prompt in Pi to refresh it, then retry");
  }

  const accountId = credential.accountId || accountIdFromJwt(credential.access);
  if (typeof accountId !== "string" || !accountId) {
    throw new Error("The Pi Codex OAuth token has no ChatGPT account ID");
  }
  return { token: credential.access, accountId };
}

function accountIdFromJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload["https://api.openai.com/auth"]?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}
