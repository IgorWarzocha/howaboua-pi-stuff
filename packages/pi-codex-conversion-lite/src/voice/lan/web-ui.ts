import type { Theme } from "@earendil-works/pi-coding-agent";
import { LAN_VOICE_BROWSER_SCRIPT } from "./browser-script.ts";
import { resolveLanVoiceWebTheme } from "./theme.ts";

export function createLanVoiceWebUi(piTheme: Theme): string {
	const theme = resolveLanVoiceWebTheme(piTheme);
	return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="${theme.pageColor}">
  <title>Pi voice</title>
  <style>
    :root { ${theme.variables}; color-scheme:${theme.colorScheme}; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--pi-user-message-bg); color:var(--pi-text); }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100svh; padding:24px; background:radial-gradient(circle at 50% 16%,var(--pi-custom-message-bg) 0,var(--pi-user-message-bg) 58%); }
    main { width:min(100%,480px); margin:auto; display:grid; justify-items:center; gap:22px; text-align:center; }
    header { display:grid; gap:7px; }
    h1 { margin:0; font:600 clamp(28px,8vw,42px)/1 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:-.06em; }
    .eyebrow { margin:0; color:var(--pi-muted); font-size:12px; letter-spacing:.13em; text-transform:uppercase; }
    .modes { display:grid; grid-template-columns:1fr 1fr; gap:4px; width:220px; padding:4px; border:1px solid var(--pi-border-muted); border-radius:999px; background:var(--pi-tool-pending-bg); }
    .modes button { border:0; border-radius:999px; padding:9px 14px; color:var(--pi-muted); background:transparent; font:600 13px/1 system-ui,sans-serif; cursor:pointer; }
    .modes button[aria-selected="true"] { color:var(--pi-accent); background:var(--pi-selected-bg); }
    .modes button:disabled { cursor:default; opacity:.65; }
    #voice { width:148px; height:148px; border:1px solid var(--pi-border); border-radius:50%; display:grid; place-items:center; cursor:pointer; color:var(--pi-accent); background:var(--pi-selected-bg); box-shadow:0 18px 50px color-mix(in srgb,var(--pi-border) 24%,transparent),inset 0 1px color-mix(in srgb,var(--pi-text) 45%,transparent); transition:transform 160ms ease,background 160ms ease,box-shadow 160ms ease; }
    #voice:hover { transform:translateY(-2px); box-shadow:0 22px 60px color-mix(in srgb,var(--pi-border) 32%,transparent),inset 0 1px color-mix(in srgb,var(--pi-text) 45%,transparent); }
    #voice:active { transform:scale(.98); }
    #voice[aria-pressed="true"] { color:var(--pi-error); background:var(--pi-tool-error-bg); border-color:var(--pi-error); box-shadow:0 0 0 10px color-mix(in srgb,var(--pi-error) 13%,transparent),0 18px 50px color-mix(in srgb,var(--pi-error) 24%,transparent); }
    #voice:disabled { cursor:wait; opacity:.65; transform:none; }
    #voice svg { width:48px; height:48px; fill:currentColor; }
    .status { min-height:54px; display:grid; gap:6px; align-content:start; }
    #state { margin:0; font-weight:650; font-size:17px; }
    #detail { margin:0; color:var(--pi-muted); font-size:13px; line-height:1.45; }
    .composer { width:100%; display:grid; gap:10px; text-align:left; }
    .composer label { color:var(--pi-muted); font-size:12px; letter-spacing:.08em; text-transform:uppercase; }
    #draft { width:100%; min-height:126px; resize:vertical; border:1px solid var(--pi-border-muted); border-radius:14px; padding:14px; color:var(--pi-text); background:var(--pi-tool-pending-bg); font:15px/1.5 system-ui,sans-serif; outline:none; caret-color:var(--pi-accent); }
    #draft:focus { border-color:var(--pi-accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--pi-accent) 15%,transparent); }
    #send { justify-self:end; border:1px solid var(--pi-border); border-radius:999px; padding:11px 20px; color:var(--pi-accent); background:var(--pi-selected-bg); font-weight:700; cursor:pointer; }
    #send:disabled { opacity:.4; cursor:default; }
    .connection { display:flex; align-items:center; gap:8px; color:var(--pi-dim); font-size:12px; }
    .dot { width:7px; height:7px; border-radius:50%; background:var(--pi-dim); }
    .connection.online .dot { background:var(--pi-success); box-shadow:0 0 12px color-mix(in srgb,var(--pi-success) 67%,transparent); }
    .connection.online { color:var(--pi-muted); }
    @media (prefers-reduced-motion:reduce) { #voice { transition:none; } }
  </style>
</head>
<body>
  <main>
    <header><p class="eyebrow">LAN companion</p><h1>Pi voice</h1></header>
    <nav class="modes" aria-label="Input mode">
      <button type="button" data-mode="conversation" aria-selected="true">Voice</button>
      <button type="button" data-mode="dictation" aria-selected="false">Dictate</button>
    </nav>
    <button id="voice" type="button" aria-pressed="false" aria-label="Start voice">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V5a3.5 3.5 0 1 0-7 0v7a3.5 3.5 0 0 0 3.5 3.5Zm-1-10.5a1 1 0 0 1 2 0v7a1 1 0 1 1-2 0V5Zm7 6a1 1 0 0 1 1 1 7 7 0 0 1-6 6.92V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.08A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 0 0 10 0 1 1 0 0 1 1-1Z"/></svg>
    </button>
    <section class="status" aria-live="polite"><p id="state">Ready</p><p id="detail">Tap to speak with this Pi session.</p></section>
    <section class="composer">
      <label for="draft">Message draft</label>
      <textarea id="draft" placeholder="Dictate or type a message…"></textarea>
      <button id="send" type="button" disabled>Send to Pi</button>
    </section>
    <div id="connection" class="connection"><span class="dot"></span><span>Connecting to Pi</span></div>
  </main>
  <script>${LAN_VOICE_BROWSER_SCRIPT}</script>
</body>
</html>`;
}
