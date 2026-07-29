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
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="GipPity">
  <link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2">
  <link rel="manifest" href="/manifest.webmanifest">
  <title>GipPity remote control</title>
  <style>
    :root { ${theme.variables}; color-scheme:${theme.colorScheme}; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--pi-user-message-bg); color:var(--pi-text); }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100svh; display:flex; padding:max(20px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left)); background:var(--pi-user-message-bg); }
    main { width:min(100%,440px); margin:auto; display:grid; gap:24px; }
    .app-header { display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .brand { display:grid; gap:3px; }
    h1 { margin:0; font:650 clamp(27px,8vw,34px)/1 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:-.055em; }
    .brand-accent { color:var(--pi-accent); }
    .tagline { margin:0; color:var(--pi-muted); font-size:12px; letter-spacing:.08em; }
    .connection { display:flex; align-items:center; gap:7px; min-height:24px; color:var(--pi-dim); font-size:12px; white-space:nowrap; }
    .dot { width:7px; height:7px; border-radius:50%; background:var(--pi-dim); }
    .connection.online .dot { background:var(--pi-success); box-shadow:0 0 10px color-mix(in srgb,var(--pi-success) 55%,transparent); }
    .connection.online { color:var(--pi-muted); }
    .voice-control { display:grid; justify-items:center; gap:16px; text-align:center; }
    .modes { display:grid; grid-template-columns:1fr 1fr; gap:4px; width:184px; padding:4px; border:1px solid var(--pi-border-muted); border-radius:12px; background:var(--pi-tool-pending-bg); }
    .modes button { min-height:36px; border:0; border-radius:9px; padding:8px 14px; color:var(--pi-muted); background:transparent; font:650 13px/1 system-ui,sans-serif; cursor:pointer; }
    .modes button[aria-pressed="true"] { color:var(--pi-accent); background:var(--pi-selected-bg); }
    .modes button:disabled { cursor:default; opacity:.65; }
    #voice { position:relative; width:128px; height:128px; border:1px solid var(--pi-border); border-radius:50%; display:grid; place-items:center; cursor:pointer; color:var(--pi-accent); background:var(--pi-selected-bg); box-shadow:0 0 0 5px color-mix(in srgb,var(--pi-border) 9%,transparent); transition:transform 150ms ease,background-color 150ms ease,border-color 150ms ease,box-shadow 150ms ease; }
    #voice::after { content:""; position:absolute; inset:-7px; border:2px solid transparent; border-radius:inherit; pointer-events:none; }
    #voice:active { transform:scale(.98); }
    #voice[aria-pressed="true"][data-mode="conversation"] { color:var(--pi-success); background:var(--pi-tool-success-bg); border-color:var(--pi-success); box-shadow:0 0 0 7px color-mix(in srgb,var(--pi-success) 13%,transparent); }
    #voice[aria-pressed="true"][data-mode="dictation"] { color:var(--pi-warning); border-color:var(--pi-warning); box-shadow:0 0 0 7px color-mix(in srgb,var(--pi-warning) 13%,transparent); }
    #voice[aria-busy="true"]::after { border-top-color:var(--pi-accent); animation:spin 800ms linear infinite; }
    #voice:disabled { cursor:wait; opacity:.65; transform:none; }
    #voice svg { width:42px; height:42px; fill:currentColor; }
    #mute { min-height:36px; display:flex; align-items:center; gap:7px; border:1px solid var(--pi-border-muted); border-radius:999px; padding:7px 12px; color:var(--pi-muted); background:var(--pi-tool-pending-bg); font:650 12px/1 system-ui,sans-serif; cursor:pointer; }
    #mute[hidden] { display:none; }
    #mute[aria-pressed="true"] { color:var(--pi-warning); border-color:var(--pi-warning); background:color-mix(in srgb,var(--pi-warning) 10%,var(--pi-tool-pending-bg)); }
    #mute svg { width:15px; height:15px; fill:currentColor; }
    .audio-status { min-height:42px; display:grid; gap:4px; align-content:start; }
    #audio-state { margin:0; font-weight:675; font-size:16px; }
    #audio-detail { margin:0; color:var(--pi-muted); font-size:13px; line-height:1.4; }
    #audio-detail:empty { display:none; }
    .activity { display:grid; gap:9px; max-height:168px; overflow:auto; border-left:2px solid var(--pi-accent); padding:12px 14px; background:color-mix(in srgb,var(--pi-custom-message-bg) 64%,transparent); }
    .activity[hidden] { display:none; }
    .activity-header { display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .activity-label { color:var(--pi-accent); font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace; }
    #activity-state { color:var(--pi-muted); font-size:12px; }
    #activity-text { margin:0; color:var(--pi-text); font-size:13px; line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; }
    .composer { display:grid; gap:10px; border-top:1px solid var(--pi-border-muted); padding-top:20px; }
    .composer label { color:var(--pi-muted); font-size:12px; letter-spacing:.08em; text-transform:uppercase; }
    #draft { width:100%; min-height:112px; resize:vertical; border:1px solid var(--pi-border-muted); border-radius:12px; padding:13px 14px; color:var(--pi-text); background:var(--pi-tool-pending-bg); font:15px/1.5 system-ui,sans-serif; outline:none; caret-color:var(--pi-accent); }
    #draft:focus { border-color:var(--pi-accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--pi-accent) 15%,transparent); }
    .composer-actions { min-height:44px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
    #composer-status { margin:0; color:var(--pi-muted); font-size:12px; line-height:1.35; }
    #composer-status:empty { display:none; }
    #send { min-width:84px; min-height:44px; border:1px solid var(--pi-border); border-radius:10px; padding:10px 18px; color:var(--pi-accent); background:var(--pi-selected-bg); font-weight:700; cursor:pointer; }
    #send:disabled { opacity:.4; cursor:default; }
    button:focus-visible,#draft:focus-visible { outline:2px solid var(--pi-accent); outline-offset:3px; }
    @media (hover:hover) { #voice:not(:disabled):hover { transform:translateY(-2px); box-shadow:0 0 0 7px color-mix(in srgb,var(--pi-accent) 14%,transparent); } #mute:not(:disabled):hover,#send:not(:disabled):hover { border-color:var(--pi-accent); } }
    @media (pointer:coarse) { .modes button { min-height:44px; } }
    @media (max-width:360px) { .app-header { gap:12px; } h1 { font-size:25px; } .modes { width:160px; } }
    @media (orientation:landscape) and (max-height:520px) and (min-width:600px) { main { width:min(100%,720px); grid-template-columns:280px 1fr; align-items:start; } .app-header { grid-column:1/-1; } .voice-control { grid-column:1; grid-row:2 / span 2; } .activity,.composer { grid-column:2; } #voice { width:112px; height:112px; } }
    @keyframes spin { to { transform:rotate(360deg); } }
    @media (prefers-reduced-motion:reduce) { #voice { transition:none; } #voice[aria-busy="true"]::after { animation:none; border-color:var(--pi-accent); } }
  </style>
</head>
<body>
  <main>
    <header class="app-header">
      <div class="brand"><h1>Gip<span class="brand-accent">Pi</span>ty</h1><p class="tagline">remote control</p></div>
      <nav class="modes" aria-label="Input mode">
        <button type="button" data-mode="conversation" aria-pressed="true">Voice</button>
        <button type="button" data-mode="dictation" aria-pressed="false">Dictate</button>
      </nav>
    </header>
    <section class="voice-control" aria-label="Audio control">
      <button id="voice" type="button" data-mode="conversation" aria-busy="false" aria-pressed="false" aria-label="Start voice">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V5a3.5 3.5 0 1 0-7 0v7a3.5 3.5 0 0 0 3.5 3.5Zm-1-10.5a1 1 0 0 1 2 0v7a1 1 0 1 1-2 0V5Zm7 6a1 1 0 0 1 1 1 7 7 0 0 1-6 6.92V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.08A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 0 0 10 0 1 1 0 0 1 1-1Z"/></svg>
      </button>
      <button id="mute" type="button" aria-pressed="false" aria-label="Mute microphone" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3Zm-1-10a1 1 0 1 1 2 0v7a1 1 0 1 1-2 0V5Zm7 6a1 1 0 0 1 1 1 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 0 0 10 0 1 1 0 0 1 1-1Z"/></svg><span>Mute mic</span></button>
      <div class="audio-status" aria-live="polite"><p id="audio-state">Tap to start voice</p><p id="audio-detail"></p></div>
    </section>
    <section id="activity" class="activity" aria-live="polite" hidden>
      <div class="activity-header"><span class="activity-label">Pi</span><span id="activity-state"></span></div>
      <p id="activity-text"></p>
    </section>
    <section class="composer">
      <label for="draft">Message</label>
      <textarea id="draft" placeholder="Type or dictate…"></textarea>
      <p id="composer-status" aria-live="polite"></p>
      <div class="composer-actions"><div id="connection" class="connection" role="status"><span class="dot"></span><span>Connecting</span></div><button id="send" type="button" disabled>Send</button></div>
    </section>
  </main>
  <script>${LAN_VOICE_BROWSER_SCRIPT}</script>
</body>
</html>`;
}
