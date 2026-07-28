import { LAN_VOICE_AUDIO_WORKLET } from "./audio-worklet.ts";

const AUDIO_WORKLET_SOURCE = JSON.stringify(LAN_VOICE_AUDIO_WORKLET);

export const LAN_VOICE_BROWSER_SCRIPT = String.raw`
const button = document.querySelector('#voice');
const state = document.querySelector('#state');
const detail = document.querySelector('#detail');
const connection = document.querySelector('#connection');
const draft = document.querySelector('#draft');
const send = document.querySelector('#send');
const modeButtons = [...document.querySelectorAll('[data-mode]')];
const clientId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
let socket;
let stream;
let context;
let source;
let processor;
let mode = 'conversation';
let active = false;
let busy = false;
let draftTimer;
let draftRevision = -1;
let draftDirty = false;
let draftSyncing = false;

const setStatus = (title, message) => { state.textContent = title; detail.textContent = message; };
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
const updateControls = () => {
  button.disabled = busy;
  modeButtons.forEach((item) => { item.disabled = busy || active; });
  draft.disabled = busy || draftRevision < 0;
  send.disabled = busy || active || draftRevision < 0 || !draft.value.trim();
};
const syncDraft = () => {
  draftDirty = true;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { void flushDraft(); }, 180);
};
async function flushDraft() {
  if (draftSyncing || !draftDirty || draftRevision < 0) return;
  draftSyncing = true;
  draftDirty = false;
  const text = draft.value;
  try {
    const result = await post('/api/draft', { text, revision:draftRevision });
    if (typeof result.revision === 'number') draftRevision = Math.max(draftRevision, result.revision);
  } catch (error) {
    report('draft.sync_error', errorData(error));
    setStatus('Draft changed', error instanceof Error ? error.message : String(error));
  } finally {
    draftSyncing = false;
    if (draftDirty) void flushDraft();
  }
}

const events = new EventSource('/api/events?client=' + encodeURIComponent(clientId));
events.onopen = () => { connection.classList.add('online'); connection.lastElementChild.textContent = 'Connected to Pi'; report('sse.open'); };
events.onerror = () => { connection.classList.remove('online'); connection.lastElementChild.textContent = 'Reconnecting to Pi'; report('sse.error', { readyState:events.readyState }); };
events.onmessage = (event) => {
  try {
    const command = JSON.parse(event.data);
    report('sse.message', command);
    if (command.type === 'stop') void stop(false, command.reason || 'server');
    if (command.type === 'error') { void stop(false, 'server-error'); setStatus('Voice stopped', command.message); }
    if (command.type === 'draft' && typeof command.text === 'string' && typeof command.revision === 'number' && command.revision >= draftRevision) {
      const preserveLocal = command.sourceClientId === clientId && command.reason === 'update' && (draftDirty || draftSyncing) && draft.value !== command.text;
      draftRevision = command.revision;
      if (preserveLocal) { updateControls(); return; }
      if (command.sourceClientId !== clientId) {
        clearTimeout(draftTimer);
        draftDirty = false;
      }
      const start = draft.selectionStart;
      const end = draft.selectionEnd;
      draft.value = command.text;
      if (document.activeElement === draft) draft.setSelectionRange(Math.min(start, draft.value.length), Math.min(end, draft.value.length));
      updateControls();
    }
    if (command.type === 'sent') setStatus('Sent to Pi', 'Your message is running in the connected session.');
  } catch (error) { report('sse.message_error', errorData(error)); }
};

async function start() {
  if (busy || active) return;
  busy = true;
  updateControls();
  setStatus('Opening microphone…', 'Use the browser prompt to allow audio.');
  report('call.start_requested', { mode });
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS and certificate acceptance.');
    if (!globalThis.AudioWorkletNode) throw new Error('This browser does not support the required low-latency audio runtime.');
    stream = await navigator.mediaDevices.getUserMedia({ audio:{ channelCount:1, echoCancellation:true, noiseSuppression:true, autoGainControl:true } });
    context = new AudioContext({ latencyHint:'interactive' });
    const workletUrl = URL.createObjectURL(new Blob([${AUDIO_WORKLET_SOURCE}], { type:'text/javascript' }));
    try { await context.audioWorklet.addModule(workletUrl); }
    finally { URL.revokeObjectURL(workletUrl); }
    await context.resume();
    source = context.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(context, 'pi-lan-voice', { numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1] });
    source.connect(processor);
    processor.connect(context.destination);
    const currentSocket = new WebSocket('wss://' + location.host + '/api/audio?client=' + encodeURIComponent(clientId));
    currentSocket.binaryType = 'arraybuffer';
    socket = currentSocket;
    const connectTimer = setTimeout(() => {
      if (socket !== currentSocket || currentSocket.readyState !== WebSocket.CONNECTING) return;
      void stop(false, 'connect-timeout');
      setStatus('Could not start', 'Timed out connecting to Pi. Tap to retry.');
    }, 10000);
    processor.port.onmessage = (event) => {
      if (active && socket === currentSocket && currentSocket.readyState === WebSocket.OPEN && currentSocket.bufferedAmount < 65536) currentSocket.send(event.data);
    };
    currentSocket.onopen = () => {
      clearTimeout(connectTimer);
      report('audio_socket.open', { mode, sampleRate:context.sampleRate });
      currentSocket.send(JSON.stringify({ type:'start', mode }));
      setStatus('Connecting…', mode === 'dictation' ? 'Opening transcription.' : 'Keeping your existing voice conversation.');
    };
    currentSocket.onmessage = (event) => receiveAudioMessage(currentSocket, event);
    currentSocket.onerror = (event) => report('audio_socket.error', { type:event.type });
    currentSocket.onclose = (event) => {
      clearTimeout(connectTimer);
      report('audio_socket.close', { code:event.code, reason:event.reason });
      if (socket === currentSocket) void stop(false, event.reason || 'connection-closed');
    };
    report('microphone.opened', { mode, sampleRate:context.sampleRate, tracks:stream.getAudioTracks().map((track) => ({ label:track.label, settings:track.getSettings?.() })) });
  } catch (error) {
    report('call.start_error', errorData(error));
    await stop(false, 'start-error');
    setStatus('Could not start', error instanceof Error ? error.message : String(error));
  } finally {
    if (!socket) busy = false;
    updateControls();
  }
}

function receiveAudioMessage(currentSocket, event) {
  if (event.data instanceof ArrayBuffer) { if (mode === 'conversation') processor?.port.postMessage(event.data, [event.data]); return; }
  try {
    const message = JSON.parse(event.data);
    report('audio_socket.message', message);
    if (message.type === 'active') {
      active = true;
      busy = false;
      button.setAttribute('aria-pressed', 'true');
      button.setAttribute('aria-label', mode === 'dictation' ? 'Finish dictation' : 'Stop voice');
      setStatus(mode === 'dictation' ? 'Dictating' : 'Listening', mode === 'dictation' ? 'Tap again to transcribe into the draft.' : 'Speak naturally. Tap again to stop.');
      updateControls();
    }
    if (message.type === 'dictation.complete') {
      busy = false;
      currentSocket.close(1000, 'dictation-complete');
      setStatus('Draft ready', 'Edit the transcript, then send it to Pi.');
      updateControls();
    }
    if (message.type === 'error') { void stop(false, 'upstream-error'); setStatus('Could not start', message.message); }
  } catch (error) { report('audio_socket.message_error', errorData(error)); }
}

async function stop(notify = true, reason = 'user') {
  report('call.stop', { notify, reason, active, mode });
  if (notify && active && mode === 'dictation' && socket?.readyState === WebSocket.OPEN) {
    active = false;
    busy = true;
    socket.send(JSON.stringify({ type:'finish', draft:draft.value, revision:draftRevision, selectionStart:draft.selectionStart, selectionEnd:draft.selectionEnd }));
    await closeAudioHardware();
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', 'Start dictation');
    setStatus('Transcribing…', 'Your recording will appear in the draft.');
    updateControls();
    return;
  }
  active = false;
  const currentSocket = socket;
  socket = undefined;
  if (notify && currentSocket?.readyState === WebSocket.OPEN) currentSocket.send(JSON.stringify({ type:'release' }));
  currentSocket?.close(1000, reason);
  await closeAudioHardware();
  busy = false;
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', mode === 'dictation' ? 'Start dictation' : 'Start voice');
  if (reason !== 'upstream-error' && reason !== 'server-error' && reason !== 'dictation-complete') {
    setStatus('Ready', mode === 'dictation' ? 'Tap to dictate into the draft.' : 'Tap to speak with this Pi session.');
  }
  updateControls();
}

async function closeAudioHardware() {
  processor?.disconnect(); processor = undefined;
  source?.disconnect(); source = undefined;
  stream?.getTracks().forEach((track) => track.stop()); stream = undefined;
  const currentContext = context; context = undefined;
  await currentContext?.close().catch(() => {});
}

function selectMode(nextMode) {
  if (active || busy || (nextMode !== 'conversation' && nextMode !== 'dictation')) return;
  mode = nextMode;
  modeButtons.forEach((item) => item.setAttribute('aria-selected', String(item.dataset.mode === mode)));
  button.setAttribute('aria-label', mode === 'dictation' ? 'Start dictation' : 'Start voice');
  setStatus('Ready', mode === 'dictation' ? 'Tap to dictate into the draft.' : 'Tap to speak with this Pi session.');
}

async function sendDraft() {
  if (busy || active || !draft.value.trim()) return;
  busy = true;
  updateControls();
  setStatus('Sending…', 'Routing this message through the connected Pi session.');
  try {
    clearTimeout(draftTimer);
    const text = draft.value;
    await post('/api/send', { text, revision:draftRevision });
    draft.value = '';
    setStatus('Sent to Pi', 'Your message is running in the connected session.');
  } catch (error) {
    report('draft.send_error', errorData(error));
    setStatus('Could not send', error instanceof Error ? error.message : String(error));
  } finally {
    busy = false;
    updateControls();
  }
}

button.addEventListener('click', () => active ? void stop() : void start());
modeButtons.forEach((item) => item.addEventListener('click', () => selectMode(item.dataset.mode)));
draft.addEventListener('input', () => { syncDraft(); updateControls(); });
send.addEventListener('click', () => void sendDraft());
window.addEventListener('error', (event) => report('window.error', { message:event.message, error:errorData(event.error) }));
window.addEventListener('unhandledrejection', (event) => report('window.unhandled_rejection', errorData(event.reason)));
window.addEventListener('pagehide', () => {
  clearTimeout(draftTimer);
  stream?.getTracks().forEach((track) => track.stop());
  navigator.sendBeacon('/api/draft', new Blob([JSON.stringify({ clientId, text:draft.value, revision:draftRevision })], {type:'application/json'}));
  if (active) navigator.sendBeacon('/api/stop', new Blob([JSON.stringify({ clientId })], {type:'application/json'}));
});
updateControls();
report('page.loaded', { clientId, userAgent:navigator.userAgent, secureContext:window.isSecureContext });
`;
