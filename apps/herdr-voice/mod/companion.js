import { appHome, readTextFile } from "herdr";

export async function request(path, body) {
  let config;
  try {
    config = JSON.parse(await readTextFile(appHome() + "/mods/voice/companion.json"));
    if (!config || !/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(config.endpoint) ||
        typeof config.token !== "string" || !config.token.trim()) throw new Error("Invalid config");
  } catch (_) {
    throw new Error("Voice setup is missing or invalid. Run the companion installer again.");
  }
  let response;
  try {
    response = await fetch(config.endpoint + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: "Bearer " + config.token, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (_) {
    throw new Error("Cannot reach the voice companion. Start herdr-voice serve on this computer.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Voice authorization failed. Run the companion installer again.");
  }
  let data;
  try { data = await response.json(); }
  catch (_) { throw new Error("The voice companion returned an invalid response."); }
  if (!response.ok) {
    const error = new Error(typeof data?.error === "string" ? data.error : "Voice request failed (HTTP " + response.status + ").");
    if (typeof data?.terminal === "string" && /^[^\s]+$/.test(data.terminal)) error.terminal = data.terminal;
    throw error;
  }
  return data;
}

export function parseStatus(data) {
  const nullableString = (value) => value === null || typeof value === "string";
  if (!data || !["idle", "connecting", "listening", "muted", "error"].includes(data.phase) ||
      ![null, "grok", "gippity", "codex"].includes(data.provider) || typeof data.muted !== "boolean" ||
      !nullableString(data.url) || !nullableString(data.error)) {
    throw new Error("The voice companion returned an invalid status.");
  }
  return { phase: data.phase, provider: data.provider, url: data.url, muted: data.muted, error: data.error };
}

export function parseDevices(data) {
  const valid = (list) => Array.isArray(list) && list.every((d) =>
    d && typeof d.name === "string" && d.name.length > 0 && typeof d.description === "string");
  if (!data || !valid(data.microphones) || !valid(data.speakers)) {
    throw new Error("The voice companion returned an invalid device list.");
  }
  return data;
}

export function parsePreparation(data, provider) {
  const connect = data?.connect;
  if (typeof data?.terminal !== "string" || !data.terminal.trim() ||
      !connect || !(connect.provider === provider || (provider === "gippity" && connect.provider === "codex")) || typeof connect.url !== "string" ||
      !/^https:\/\/[^\s/]+/.test(connect.url) ||
      ["sshHost", "certificate", "microphone", "speaker"].some((key) =>
        connect[key] !== undefined && connect[key] !== null && typeof connect[key] !== "string")) {
    throw new Error("Voice preparation returned an invalid connection. No microphone was started.");
  }
  const body = { provider: connect.provider, url: connect.url };
  for (const key of ["sshHost", "certificate", "microphone", "speaker"]) {
    if (connect[key]) body[key] = connect[key];
  }
  return { terminal: data.terminal, connect: body };
}
