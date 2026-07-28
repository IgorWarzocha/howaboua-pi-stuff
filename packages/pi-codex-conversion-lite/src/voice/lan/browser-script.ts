import { LAN_VOICE_BROWSER_AUDIO_SCRIPT } from "./browser-audio-script.ts";
import { LAN_VOICE_BROWSER_COMPOSER_SCRIPT } from "./browser-composer-script.ts";
import { LAN_VOICE_BROWSER_EVENTS_SCRIPT } from "./browser-events-script.ts";

export const LAN_VOICE_BROWSER_SCRIPT = String.raw`
const clientId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
const errorData = (error) => error instanceof Error ? { name:error.name, message:error.message, stack:error.stack, cause:error.cause } : { value:String(error) };
const report = (event, data) => {
  void fetch('/api/debug', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ clientId, event, data }), keepalive:true }).catch(() => {});
};
const post = async (path, body) => {
  const response = await fetch(path, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ clientId, ...body }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Pi rejected the request');
  return result;
};

${LAN_VOICE_BROWSER_COMPOSER_SCRIPT}
${LAN_VOICE_BROWSER_AUDIO_SCRIPT}
${LAN_VOICE_BROWSER_EVENTS_SCRIPT}

const composer = createComposer({
  draft:document.querySelector('#draft'),
  send:document.querySelector('#send'),
  status:document.querySelector('#composer-status'),
  clientId,
  post,
  report,
  errorData,
});
const audio = createAudioController({
  button:document.querySelector('#voice'),
  audioState:document.querySelector('#audio-state'),
  audioDetail:document.querySelector('#audio-detail'),
  modeButtons:[...document.querySelectorAll('[data-mode]')],
  composer,
  clientId,
  report,
  errorData,
});
connectBrowserEvents({
  clientId,
  connection:document.querySelector('#connection'),
  activity:document.querySelector('#activity'),
  activityState:document.querySelector('#activity-state'),
  activityText:document.querySelector('#activity-text'),
  composer,
  audio,
  report,
  errorData,
});
window.addEventListener('error', (event) => report('window.error', { message:event.message, error:errorData(event.error) }));
window.addEventListener('unhandledrejection', (event) => report('window.unhandled_rejection', errorData(event.reason)));
window.addEventListener('pagehide', () => { composer.pagehide(); audio.pagehide(); });
report('page.loaded', { clientId, userAgent:navigator.userAgent, secureContext:window.isSecureContext });
`;
