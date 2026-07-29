import { LAN_VOICE_BROWSER_AUDIO_SCRIPT } from "./browser-audio-script.ts";
import { LAN_VOICE_BROWSER_COMPOSER_SCRIPT } from "./browser-composer-script.ts";
import { LAN_VOICE_BROWSER_EVENTS_SCRIPT } from "./browser-events-script.ts";

export const LAN_VOICE_BROWSER_SCRIPT = String.raw`
const clientId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
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
});
const audio = createAudioController({
	button:document.querySelector('#voice'),
	muteButton:document.querySelector('#mute'),
	audioState:document.querySelector('#audio-state'),
	audioDetail:document.querySelector('#audio-detail'),
	modeButtons:[...document.querySelectorAll('.modes [data-mode]')],
	composer,
	clientId,
	post,
});
connectBrowserEvents({
  clientId,
  connection:document.querySelector('#connection'),
  activity:document.querySelector('#activity'),
  activityState:document.querySelector('#activity-state'),
  activityText:document.querySelector('#activity-text'),
  composer,
  audio,
});
window.addEventListener('pagehide', () => { composer.pagehide(); audio.pagehide(); });
`;
