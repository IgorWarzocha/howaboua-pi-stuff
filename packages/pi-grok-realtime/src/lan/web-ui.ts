export const GROK_PAGE = String.raw`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grok · Pi voice</title>
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Grok"><meta name="theme-color" content="#111">
<style>
:root{font-family:system-ui,sans-serif;color-scheme:light dark;background:var(--pi-user-message-bg,Canvas);color:var(--pi-text,CanvasText)}
*{box-sizing:border-box}body{max-width:640px;margin:0 auto;padding:24px 20px 32px}h1{font-size:28px;font-weight:550;letter-spacing:-.8px;margin:0}h1 span{font-size:18px;font-weight:400;color:var(--pi-muted,GrayText);letter-spacing:0}h2{font-size:16px;margin:0 0 8px}p{margin:8px 0;line-height:1.5}p,small,footer{color:var(--pi-muted,GrayText)}
button,textarea,input,select{font:inherit;color:inherit;border:1px solid var(--pi-border,GrayText);background:var(--pi-custom-message-bg,Canvas);border-radius:6px;padding:12px}button,input,select{min-height:44px}button{cursor:pointer;padding:10px 14px}button:disabled{opacity:.4;cursor:default}:focus-visible{outline:2px solid var(--pi-accent,Highlight);outline-offset:3px}#start{font-weight:600;background:var(--pi-accent,CanvasText);color:var(--pi-user-message-bg,Canvas)}
#status{font-family:monospace;font-size:13px;line-height:1.5;padding:12px 0 16px;overflow-wrap:anywhere}.call-controls{padding:16px 0;border-block:1px solid var(--pi-border-muted,GrayText)}label{display:block}.call-controls label{margin:0 0 8px;font-size:14px}.call-controls select{width:100%}nav{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}nav button{flex:1 1 auto}#stop{flex-grow:0}
#activity{padding:20px 0 4px}#activity-text,#prompt{white-space:pre-wrap;overflow-wrap:anywhere}#prompt,#audio-warning{color:var(--pi-warning,CanvasText)}#activity-text:empty,#prompt:empty,#audio-warning:empty,#error:empty,#settings-status:empty{display:none}#dictation-status{overflow-wrap:anywhere}
#composer{margin:16px 0 24px}#composer label{font-weight:600}textarea{display:block;width:100%;margin:8px 0;min-height:104px;resize:vertical}#composer button{display:block;margin-left:auto;min-width:88px}#error{color:var(--pi-error,CanvasText);margin:12px 0}
details{padding:16px 0;border-top:1px solid var(--pi-border-muted,GrayText)}summary{cursor:pointer;min-height:28px;line-height:1.6}fieldset{border:0;padding:0;margin:0}#settings label{margin-top:16px}#settings input,#settings select{display:block;width:100%;margin:8px 0}#settings small{display:block;line-height:1.5}#settings input[type=checkbox]{min-height:auto}#save-settings{display:block;margin-top:16px}#help p{font-size:14px;line-height:1.6;margin:12px 0}#help h2{margin-top:20px}a{color:var(--pi-accent,LinkText)}footer{font-size:12px;padding-top:12px}[hidden]{display:none!important}
@media(max-width:380px){body{padding:20px 14px}nav button{flex-basis:calc(50% - 8px)}}
</style>
<main><h1>Grok <span>· Pi</span></h1>
<div id="status" role="status" aria-live="polite">Connecting to Pi…</div>
<section class="call-controls" aria-label="Microphone and call">
<label for="mode">Microphone mode</label><select id="mode"><option value="voice">Voice conversation</option><option value="dictation">Dictation into draft</option></select>
<nav aria-label="Call controls"><button id="start">Start voice</button><button id="stop" disabled>Stop call</button><button id="finish" hidden>Finish dictation</button><button id="cancel" hidden>Cancel dictation</button></nav>
<nav aria-label="Audio controls"><button id="mute" aria-pressed="false" disabled>Mute microphone</button><button id="speaker" aria-pressed="false" disabled>Silence speaker</button><button id="resume" hidden>Resume audio</button></nav>
<p id="audio-warning" role="status"></p><p id="dictation-status" role="status" hidden></p></section>
<section id="activity" aria-label="Pi activity"><h2 id="activity-status">Pi</h2><div id="activity-text"></div><p id="prompt" role="status"></p></section>
<form id="composer"><label for="text">Send to Pi</label><textarea id="text" rows="3" required></textarea><button type="submit">Send</button></form>
<p id="error" role="alert"></p>
<details><summary>Settings</summary><p><small>Saved settings apply when the next voice call starts.</small></p>
<form id="settings"><fieldset disabled id="settings-fields">
<label for="access">Access</label><select id="access" name="access"><option value="oauth">OAuth</option><option value="api_key">API key</option></select>
<label for="voice">Primary voice</label><input id="voice" name="voice" list="voices" required><datalist id="voices"></datalist>
<label for="alternateVoice">Alternate voice</label><input id="alternateVoice" name="alternateVoice" list="voices" required><small>Session transfers alternate between primary and alternate voices.</small>
<label for="model">Realtime model</label><input id="model" name="model" list="models" required><datalist id="models"></datalist>
<small>Custom IDs are allowed. Voice and model availability depends on your account.</small>
<label for="reasoning">Reasoning effort</label><select id="reasoning" name="reasoning"><option value="high">High</option><option value="none">None</option></select>
<label for="webSearch"><input id="webSearch" name="webSearch" type="checkbox" style="display:inline;width:auto;margin:0 8px 0 0">Native web search</label><small>xAI executes searches directly, bypassing Pi. Extra provider tool charges apply.</small>
<label for="contextModel">Context summary model</label><input id="contextModel" name="contextModel" list="contextModels" placeholder="current, off, or provider/modelId" required><datalist id="contextModels"></datalist>
<label for="contextReasoning">Context summary reasoning</label><select id="contextReasoning" name="contextReasoning"><option value="off">Off</option><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option></select>
<label for="speed">Speech speed</label><input id="speed" name="speed" type="number" step="any" list="speeds" required><datalist id="speeds"></datalist>
<label for="language">Transcription language</label><input id="language" name="language" placeholder="auto or en-US" required>
<label for="silenceSeconds">Follow-up after silence, seconds</label><input id="silenceSeconds" name="silenceSeconds" type="number" min="0" step="any" required><small>0 turns it off. Follow-ups pause while Pi works or the microphone is muted.</small>
<label for="autoResume"><input id="autoResume" name="autoResume" type="checkbox" style="display:inline;width:auto;margin:0 8px 0 0">Resume dropped voice calls automatically</label>
<button id="save-settings" type="submit">Save settings</button></fieldset><p id="settings-status" role="status"></p></form></details>
<details id="help"><summary>Help</summary><p>Start voice to talk with Grok. Pi handles work in the current session. Send a message below the call controls when you prefer to type.</p><p>Dictation transcribes into the editable draft. Finish dictation adds the transcript without sending it. Review the draft, then tap Send.</p><p>Closing this page leaves the host call running. Stop call ends it. Silence speaker only affects playback in this browser.</p><h2>Billing</h2><p>Voice is billed for connected time, including silence, and billable text inputs such as context updates. Dictation uses speech-to-text pricing separately.</p><p>Context summaries use the selected model's pricing or subscription allowance. Native web search adds provider tool charges.</p><p><a href="https://docs.x.ai/developers/models/speech-to-speech">Current xAI pricing</a></p></details>
<footer>Trusted LAN only · no sign-in</footer></main>
<script src="/client.js" defer></script></html>`;

export const GROK_CLIENT = String.raw`
const status = document.getElementById('status');
const error = document.getElementById('error');
const start = document.getElementById('start');
const stop = document.getElementById('stop');
const mute = document.getElementById('mute');
const resume = document.getElementById('resume');
const mode = document.getElementById('mode');
const finish = document.getElementById('finish');
const cancel = document.getElementById('cancel');
const speaker = document.getElementById('speaker');
const audioWarning = document.getElementById('audio-warning');
let speakerSuppressed = false;
let dictationStatus = 'idle';
let dictationDelivered = false;
let finishing = false;
let quiet = false;
let callStatus = 'idle';
function audioHealth() {
  const paused = connection && connection.context.state !== 'running';
  resume.hidden = !paused;
  audioWarning.textContent = paused ? 'Browser speaker blocked or paused. Tap Resume audio.' : quiet && !muted ? 'Microphone level is too low.' : '';
}
let connection = null;
let muted = false;
let starting = false;
let attempt = 0;
let epoch = 0;
const settings = document.getElementById('settings');
const settingsStatus = document.getElementById('settings-status');
const settingKeys = ['access','voice','alternateVoice','model','reasoning','webSearch','autoResume','contextModel','contextReasoning','speed','language','silenceSeconds'];
let savedSettings = {};
function showSettings(config) {
  savedSettings = config;
  for (const key of settingKeys) {
    const field = settings.elements.namedItem(key);
    if (key === 'webSearch' || key === 'autoResume') field.checked = config[key];
    else field.value = String(config[key]);
  }
}
async function loadSettings() {
  const response = await fetch('/settings');
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Settings unavailable');
  for (const key of ['voices','models','contextModels','speeds']) {
    const list = document.getElementById(key);
    list.replaceChildren(...value[key].map(id => new Option(id,id)));
  }
  showSettings(value.config);
  document.getElementById('settings-fields').disabled = false;
}
settings.onsubmit = async event => {
  event.preventDefault();
  const button = document.getElementById('save-settings');
  button.disabled = true; settingsStatus.textContent = '';
  try {
    const patch = {};
    for (const key of settingKeys) {
      const field = settings.elements.namedItem(key);
      const input = field.value.trim();
      const value = key === 'webSearch' || key === 'autoResume' ? field.checked : key === 'speed' || key === 'silenceSeconds' ? Number(input) : input;
      if (value !== savedSettings[key]) patch[key] = value;
    }
    const response = await fetch('/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Settings could not be saved');
    showSettings(value.config);
    settingsStatus.textContent = 'Saved for the next call. Stop the current call before starting with new settings.';
  } catch (reason) { fail(reason); }
  finally { button.disabled = false; }
};
function fail(reason) { error.textContent = reason instanceof Error ? reason.message : String(reason); }
function applyMute(value) {
  if (muted === value) return;
  muted = value;
  if (connection) {
    connection.pendingAudio = [];
    for (const track of connection.stream.getAudioTracks()) track.enabled = !muted;
    connection.node.port.postMessage({type:'input_muted',muted,epoch:++epoch});
  }
}
function render(state) {
  callStatus = state.status;
  dictationStatus = state.dictation.status;
  if (dictationStatus === 'connecting' || dictationStatus === 'recording') dictationDelivered = false;
  modeControls();
  document.getElementById('activity-status').textContent = 'Pi · ' + state.activity.status;
  document.getElementById('activity-text').textContent = state.activity.text;
  document.getElementById('prompt').textContent = state.activity.prompt || '';
  document.getElementById('dictation-status').textContent = (state.dictation.error || state.dictation.status) + (state.dictation.text ? ' · ' + state.dictation.text : '');
  document.getElementById('dictation-status').hidden = mode.value !== 'dictation' || dictationStatus === 'idle';
  if (!starting || connection) status.textContent = state.status + (state.piBusy ? ' · Pi working' : '') + (connection ? ' · browser microphone connected' : ' · no browser microphone');
  applyMute(state.muted);
  mute.textContent = muted ? 'Unmute microphone' : 'Mute microphone';
  mute.setAttribute('aria-pressed', String(muted));
  audioHealth();
}
async function control(command) {
  const response = await fetch('/control', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Control failed');
  render(value);
  return value;
}
async function release(current) {
  if (!current || current.released) return;
  current.released = true;
  if (connection === current) connection = null;
  current.socket?.close();
  current.pendingAudio = [];
  current.stream?.getTracks().forEach(track => track.stop());
  current.node?.disconnect();
  await current.context?.close();
  if (!connection) resume.hidden = true;
  quiet = false; audioHealth();
  modeControls();
}
start.onclick = async () => {
  if (starting || connection) return;
  starting = true; modeControls(); error.textContent = '';
  const ticket = ++attempt;
  let current;
  try {
    // Create and resume under the click's user activation, before permission awaits.
    const context = new AudioContext();
    current = {context,pendingAudio:[],audioReady:false,mode:mode.value};
    await context.resume();
    if (ticket !== attempt) { await release(current); return; }
    status.textContent = 'Allow microphone access to start voice';
    const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    current.stream = stream;
    if (ticket !== attempt) { await release(current); return; }
    status.textContent = 'Preparing browser audio';
    await context.audioWorklet.addModule('/worklet.js');
    if (ticket !== attempt) { await release(current); return; }
    const node = new AudioWorkletNode(context,'grok-audio',{outputChannelCount:[1]}); current.node = node;
    context.createMediaStreamSource(stream).connect(node); node.connect(context.destination);
    const socket = new WebSocket(location.origin.replace('https:','wss:') + '/audio' + (current.mode === 'dictation' ? '?mode=dictation' : '')); current.socket = socket;
    socket.binaryType = 'arraybuffer';
    connection = current;
    context.onstatechange = () => {
      if (current.released || connection !== current) return;
      audioHealth();
    };
    status.textContent = 'Connecting Grok voice';
    node.port.postMessage({type:'input_muted',muted,epoch:++epoch});
    node.port.postMessage({type:'speaker_suppressed',suppressed:speakerSuppressed});
    audioHealth();
    stream.getAudioTracks().forEach(track => track.enabled = !muted);
    node.port.onmessage = event => {
      if (event.data.type === 'microphone') { quiet = event.data.quiet; audioHealth(); }
      if (event.data.type === 'playback_error' && socket.readyState === WebSocket.OPEN) {
        fail(new Error('Browser playback failed; stop and start a new call.'));
        socket.send(JSON.stringify({type:'playback_error'}));
      }
      if (event.data.type === 'drained' && socket.readyState === WebSocket.OPEN) {
        const {id,time} = event.data;
        const acknowledge = () => {
          if (current.released || socket.readyState !== WebSocket.OPEN) return;
          // Compare the render boundary with actual device presentation, not a guessed farewell duration.
          if (context.getOutputTimestamp().contextTime < time) { setTimeout(acknowledge,16); return; }
          socket.send(JSON.stringify({type:'drained',id}));
        };
        acknowledge();
      }
      if (event.data.type === 'capture' && event.data.epoch === epoch && !muted && !current.released) {
        if (current.audioReady && socket.readyState === WebSocket.OPEN) socket.send(event.data.pcm);
        else current.pendingAudio.push(event.data.pcm);
      }
    };
    socket.onmessage = event => {
      if (event.data instanceof ArrayBuffer) { node.port.postMessage(event.data,[event.data]); return; }
      const value = JSON.parse(event.data);
      if (value.type === 'ready') {
        current.audioReady = true;
        if (!muted) for (const pcm of current.pendingAudio) socket.send(pcm);
        current.pendingAudio = [];
      }
      if (value.type === 'state') render(value);
      if (value.type === 'clear') node.port.postMessage({type:'clear'});
      if (value.type === 'drain') node.port.postMessage({type:'drain',id:value.id});
      if (value.type === 'mute') applyMute(value.muted);
      if (value.type === 'error') fail(value.message);
    };
    socket.onerror = () => fail(new Error('Voice connection failed. Check the host certificate and network.'));
    socket.onclose = event => { void release(current).catch(fail); status.textContent = event.reason || 'Browser microphone disconnected. Host call unchanged.'; };
    stream.getAudioTracks().forEach(track => track.onended = () => socket.close());
  } catch (reason) { fail(reason); await release(current); }
  finally { starting = false; modeControls(); }
};
resume.onclick = () => connection?.context.resume().catch(fail);
speaker.onclick = () => {
  speakerSuppressed = !speakerSuppressed;
  speaker.setAttribute('aria-pressed',String(speakerSuppressed));
  speaker.textContent = speakerSuppressed ? 'Enable speaker' : 'Silence speaker';
  connection?.node.port.postMessage({type:'speaker_suppressed',suppressed:speakerSuppressed});
};
function modeControls() {
  const dictating = mode.value === 'dictation';
  const active = callStatus !== 'idle';
  start.textContent = mode.value === 'dictation' ? 'Start dictation' : 'Start voice';
  start.disabled = starting || !!connection || finishing;
  stop.hidden = dictating;
  stop.disabled = !active && !starting && !connection;
  finish.hidden = cancel.hidden = !dictating;
  mute.hidden = speaker.hidden = dictating;
  mute.disabled = !active || dictating;
  speaker.disabled = !connection || dictating;
  document.getElementById('dictation-status').hidden = !dictating || dictationStatus === 'idle';
  finish.disabled = finishing || dictationDelivered || !['recording','done'].includes(dictationStatus);
  cancel.disabled = !['connecting','recording','finishing','done'].includes(dictationStatus);
}
mode.onchange = async () => {
  ++attempt;
  try { await control({action:'stop'}); await release(connection); modeControls(); }
  catch (reason) { fail(reason); }
};
finish.onclick = async () => {
  if (finish.disabled) return;
  ++attempt;
  finishing = true; modeControls();
  try {
    // Stop capture before signaling end-of-audio, but retain the host transcription.
    await release(connection);
    const value = await control({action:'finishDictation'});
    dictationDelivered = true;
    const draft = document.getElementById('text');
    draft.value += (draft.value && value.text ? '\n' : '') + value.text;
    draft.focus();
  } catch (reason) { fail(reason); }
  finally { finishing = false; modeControls(); }
};
cancel.onclick = async () => { ++attempt; try { await control({action:'cancelDictation'}); await release(connection); } catch (reason) { fail(reason); } };
modeControls();
stop.onclick = async () => { ++attempt; try { await control({action:'stop'}); await release(connection); } catch (reason) { fail(reason); } };
mute.onclick = () => control({action:'mute',muted:!muted}).catch(fail);
document.getElementById('composer').onsubmit = async event => {
  event.preventDefault(); const text = document.getElementById('text');
  try { await control({action:'send',text:text.value}); text.value = ''; } catch (reason) { fail(reason); }
};
async function refresh() {
  try { const response = await fetch('/state'); if (!response.ok) throw new Error('Pi connection unavailable'); render(await response.json()); }
  catch (reason) { fail(reason); }
}
void refresh();
void loadSettings().catch(fail);
void fetch('/theme').then(async response => {
  if (!response.ok) throw new Error('Pi theme unavailable');
  const theme = await response.json();
  // Values originate from Pi, not from page or control input.
  for (const declaration of theme.variables.split(';')) {
    const colon = declaration.indexOf(':');
    document.documentElement.style.setProperty(declaration.slice(0,colon), declaration.slice(colon+1));
  }
  document.documentElement.style.colorScheme = theme.colorScheme;
  document.querySelector('meta[name="theme-color"]').content = theme.pageColor;
}).catch(fail);
const poll = setInterval(refresh,2000);
window.addEventListener('pagehide',() => { clearInterval(poll); void release(connection).catch(fail); });
`;
