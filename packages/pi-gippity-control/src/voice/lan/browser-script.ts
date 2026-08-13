import { LAN_VOICE_BROWSER_AUDIO_SCRIPT } from "./browser-audio-script.ts";
import { LAN_VOICE_BROWSER_COMPOSER_SCRIPT } from "./browser-composer-script.ts";
import { LAN_VOICE_BROWSER_EVENTS_SCRIPT } from "./browser-events-script.ts";

export const LAN_VOICE_BROWSER_SCRIPT = String.raw`
${LAN_VOICE_BROWSER_COMPOSER_SCRIPT}
${LAN_VOICE_BROWSER_AUDIO_SCRIPT}
${LAN_VOICE_BROWSER_EVENTS_SCRIPT}

const client = GippityRemote.connect();
const composer = createComposer({
  draft:document.querySelector('#draft'),
  send:document.querySelector('#send'),
  status:document.querySelector('#composer-status'),
  client,
});
const audio = createAudioController({
	button:document.querySelector('#voice'),
	muteButton:document.querySelector('#mute'),
	audioState:document.querySelector('#audio-state'),
	audioDetail:document.querySelector('#audio-detail'),
	modeButtons:[...document.querySelectorAll('.modes [data-mode]')],
	composer,
	client,
});
connectBrowserEvents({
  client,
  connection:document.querySelector('#connection'),
  activity:document.querySelector('#activity'),
  activityState:document.querySelector('#activity-state'),
  activityText:document.querySelector('#activity-text'),
  composer,
  audio,
});
`;
