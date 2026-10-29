import { LAN_VOICE_AUDIO_WORKLET } from "./audio-worklet.ts";
import { LAN_VOICE_BROWSER_REALTIME_SCRIPT } from "./browser-realtime-script.ts";

const AUDIO_WORKLET_SOURCE = JSON.stringify(LAN_VOICE_AUDIO_WORKLET);

export const LAN_VOICE_BROWSER_AUDIO_SCRIPT = `${LAN_VOICE_BROWSER_REALTIME_SCRIPT}\n${String.raw`
function createAudioController({ button, muteButton, audioState, audioDetail, modeButtons, composer, clientId, post }) {
  let socket;
  let stream;
  let context;
  let source;
  let processor;
  let realtimeAudio;
  let mode = 'conversation';
  let active = false;
  let muted = false;
  let inputTooQuiet = false;
  let busy = false;
  let finishingDictation = false;
  let starting = false;
  let startGeneration = 0;
  let takeover, takeoverTimer;
  let resumeMuted = false;
  let replacingCall = false;
  let retryTimer, staleEventsTimer;
  let retryAttempt = 0;
  let retryDetail = '';

  const retryConnection = (detail) => {
    if (takeover || mode !== 'conversation' || (!active && !busy && !socket)) return;
    if (retryTimer) return;
    retryDetail ||= detail;
    if (retryAttempt >= 3) {
      const failure = retryDetail;
      stop(false, 'connection-failed');
      setStatus('Voice disconnected', failure + ' Check the connection, then tap to retry.');
      return;
    }
    resumeMuted = muted;
    active = false; busy = true;
    const previous = socket; socket = undefined;
    previous?.close(1000, 'reconnecting');
    realtimeAudio?.setSpeakerSuppressed(true);
    const delay = 1000 * 2 ** retryAttempt++;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', 'Cancel reconnect');
    setStatus('Reconnecting voice…', detail + ' Retry ' + retryAttempt + '/3 in ' + delay / 1000 + 's. Tap to cancel.');
    updateControls();
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      busy = false;
      void start();
    }, delay);
  };
  const connectionError = (message) => {
    if (mode === 'conversation' && (active || busy || socket)) { retryConnection(message || 'Voice failed.'); return; }
    stop(false, 'upstream-error'); setStatus('Could not start', message);
  };

  const setStatus = (title, message = '') => { audioState.textContent = title; audioDetail.textContent = message; };
  const renderConversationStatus = () => {
    if (!active || mode !== 'conversation') return;
    if (muted) setStatus('Microphone muted', 'Voice remains connected');
    else setStatus('Listening', inputTooQuiet ? 'Microphone level is too low' : 'Tap to stop');
  };
  const updateControls = () => {
    button.disabled = false;
    button.setAttribute('aria-busy', String(busy));
    muteButton.hidden = mode !== 'conversation' || !active;
    muteButton.disabled = busy || !active || mode !== 'conversation';
    modeButtons.forEach((item) => { item.disabled = busy || active; });
  };
  const setMuted = (nextMuted, notify = true, synchronize = false) => {
    if ((!active || mode !== 'conversation') && notify) return;
    const next = Boolean(nextMuted);
    if (muted !== next || synchronize) realtimeAudio?.setInputMuted(next);
    muted = next;
    stream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    muteButton.setAttribute('aria-pressed', String(muted));
    muteButton.setAttribute('aria-label', muted ? 'Unmute microphone' : 'Mute microphone');
    muteButton.lastElementChild.textContent = muted ? 'Unmute mic' : 'Mute mic';
    if (notify && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type:'mute', muted }));
    renderConversationStatus();
    updateControls();
  };
  const closeHardware = () => {
    const currentRealtimeAudio = realtimeAudio; realtimeAudio = undefined;
    if (currentRealtimeAudio) currentRealtimeAudio.close();
    else {
      processor?.disconnect();
      source?.disconnect();
      void context?.close().catch(() => {});
    }
    processor = undefined;
    source = undefined;
    context = undefined;
    stream?.getTracks().forEach((track) => track.stop()); stream = undefined;
  };
  const stop = (notify = true, reason = 'user') => {
    if (takeover) notify = false;
    clearTimeout(takeoverTimer); takeover = undefined; resumeMuted = false; replacingCall = false;
    clearTimeout(retryTimer); retryTimer = undefined; retryAttempt = 0; retryDetail = '';
    clearTimeout(staleEventsTimer); staleEventsTimer = undefined;
    startGeneration += 1;
    if (notify && active && mode === 'dictation' && socket?.readyState === WebSocket.OPEN) {
      const finishingSocket = socket;
      const draft = composer.snapshot();
      active = false;
      busy = true;
      finishingDictation = true;
      socket.send(JSON.stringify({ type:'finish', draft:draft.text, revision:draft.revision, selectionStart:draft.selectionStart, selectionEnd:draft.selectionEnd }));
      closeHardware();
      if (!finishingDictation || socket !== finishingSocket) return;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', 'Cancel transcription');
      setStatus('Transcribing…');
      updateControls();
      return;
    }
    active = false;
    muted = false;
    inputTooQuiet = false;
    muteButton.setAttribute('aria-pressed', 'false');
    finishingDictation = false;
    const currentSocket = socket;
    socket = undefined;
    if (notify && currentSocket?.readyState === WebSocket.OPEN) currentSocket.send(JSON.stringify({ type:'release' }));
    if (notify) void post('/api/stop', { terminateConversation: mode === 'conversation' }).catch(() => {});
    currentSocket?.close(1000, reason);
    closeHardware();
    busy = false;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', mode === 'dictation' ? 'Start dictation' : 'Start voice');
    if (reason === 'replaced') {
      setStatus('Moved to another device', 'Tap to take control here');
    } else if (reason === 'transfer-ended') {
      setStatus('Transferred session ended', 'Start voice to return to this session');
    } else if (reason !== 'upstream-error' && reason !== 'server-error' && reason !== 'dictation-complete') {
      setStatus(mode === 'dictation' ? 'Tap to start dictation' : 'Tap to start voice');
    }
    updateControls();
  };
  const receiveMessage = (currentSocket, event) => {
    if (socket !== currentSocket) return;
    if (event.data instanceof ArrayBuffer) {
      realtimeAudio?.play(event.data);
      return;
    }
    try {
      const message = JSON.parse(event.data);
	  if (message.type === 'takeover') { beginTakeover(message); return; }
	  if (message.type === 'stop') { stop(false, message.reason || 'server'); return; }
	  if (message.type === 'mute') setMuted(message.muted, false);
      if (message.type === 'speaker_suppressed') realtimeAudio?.setSpeakerSuppressed(message.suppressed);
      if (message.type === 'active') {
        const resuming = retryAttempt > 0 || replacingCall;
        retryAttempt = 0;
        retryDetail = '';
        replacingCall = false;
        active = true;
        busy = false;
        finishingDictation = false;
        button.setAttribute('aria-pressed', 'true');
        button.setAttribute('aria-label', mode === 'dictation' ? 'Finish dictation' : 'Stop voice');
        if (mode === 'conversation') {
          inputTooQuiet = false;
          const initialMuted = resuming ? resumeMuted : (typeof message.muted === 'boolean' ? message.muted : muted);
          setMuted(initialMuted, false, initialMuted);
          if (resuming) currentSocket.send(JSON.stringify({ type:'mute', muted:initialMuted }));
          resumeMuted = false;
          realtimeAudio?.setSpeakerSuppressed(Boolean(message.speakerSuppressed));
          if (!initialMuted) realtimeAudio?.releaseInput();
        }
        setMuted(muted, false);
        setStatus(mode === 'dictation' ? 'Recording' : muted ? 'Microphone muted' : 'Listening', mode === 'dictation' ? 'Tap to finish' : muted ? 'Voice remains connected' : 'Tap to stop');
        updateControls();
      }
      if (message.type === 'dictation.complete') {
        busy = false;
        finishingDictation = false;
        currentSocket.close(1000, 'dictation-complete');
        setStatus('Tap to start dictation');
        composer.setStatus('Transcript ready');
        updateControls();
      }
      if (message.type === 'error') connectionError(message.message);
    } catch {}
  };
  const start = async (takeoverToken) => {
    if (starting || busy || active) return;
    const generation = ++startGeneration;
    starting = true;
    busy = true;
    updateControls();
    setStatus(realtimeAudio ? 'Reconnecting voice…' : 'Opening microphone…', realtimeAudio ? '' : 'Allow microphone access if asked.');
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS and certificate acceptance.');
      if (!globalThis.AudioWorkletNode) throw new Error('This browser does not support the required low-latency audio runtime.');
      if (!stream?.getAudioTracks().some((track) => track.readyState === 'live')) {
        closeHardware();
        stream = await navigator.mediaDevices.getUserMedia({ audio:{ channelCount:1, echoCancellation:true, noiseSuppression:true, autoGainControl:true } });
      }
      if (generation !== startGeneration) { closeHardware(); return; }
      if (mode === 'conversation' && !realtimeAudio) {
        realtimeAudio = await createRealtimeBrowserAudio(stream);
        context = realtimeAudio.context;
        processor = realtimeAudio.processor;
      } else if (mode === 'dictation') {
        context = new AudioContext({ latencyHint:'interactive' });
        const workletUrl = URL.createObjectURL(new Blob([${AUDIO_WORKLET_SOURCE}], { type:'text/javascript' }));
        try { await context.audioWorklet.addModule(workletUrl); }
        finally { URL.revokeObjectURL(workletUrl); }
        if (generation !== startGeneration) { closeHardware(); return; }
        await context.resume();
        if (context.state !== 'running') throw new Error('Browser audio did not start. Check its media permissions.');
        if (generation !== startGeneration) { closeHardware(); return; }
        source = context.createMediaStreamSource(stream);
        processor = new AudioWorkletNode(context, 'pi-lan-voice', { numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1] });
        source.connect(processor);
        processor.connect(context.destination);
      }
      if (generation !== startGeneration) { closeHardware(); return; }
      const currentSocket = new WebSocket('wss://' + location.host + '/api/audio?client=' + encodeURIComponent(clientId));
      currentSocket.binaryType = 'arraybuffer';
      socket = currentSocket;
      updateControls();
      const connectTimer = setTimeout(() => {
        if (socket !== currentSocket || currentSocket.readyState !== WebSocket.CONNECTING) return;
        if (mode === 'conversation') { retryConnection('Connection timed out.'); return; }
        void stop(false, 'connect-timeout');
        setStatus('Could not start', 'Connection timed out. Tap to retry.');
      }, 10000);
      if (processor) processor.port.onmessage = (event) => {
        const pcm = realtimeAudio
          ? realtimeAudio.acceptCapture(event.data)
          : event.data?.type === 'capture' && event.data.epoch === 0 && event.data.pcm instanceof ArrayBuffer ? event.data.pcm : undefined;
        if (pcm && active && !muted && socket === currentSocket && currentSocket.readyState === WebSocket.OPEN && currentSocket.bufferedAmount < 65536) currentSocket.send(pcm);
      };
      currentSocket.onopen = () => {
		if (socket !== currentSocket || !context) return;
        clearTimeout(connectTimer);
        currentSocket.send(JSON.stringify({ type:'start', mode, ...(takeoverToken ? { takeoverToken } : {}) }));
        setStatus('Connecting…');
      };
      currentSocket.onmessage = (event) => receiveMessage(currentSocket, event);
      currentSocket.onclose = (event) => {
        clearTimeout(connectTimer);
        if (socket !== currentSocket) return;
        if (mode === 'conversation' && ![1002, 1003, 1007, 1008, 1009, 4001].includes(event.code)) { retryConnection('Voice connection lost.'); return; }
        const failed = replacingCall || retryAttempt > 0;
        stop(false, event.reason || 'connection-closed');
        if (failed) setStatus('Voice disconnected', 'Check the server and connection, then tap to start voice.');
      };
    } catch (error) {
      if (generation !== startGeneration) return;
      stop(false, 'start-error');
      setStatus('Could not start', error instanceof Error ? error.message : String(error));
    } finally {
      starting = false;
      if (generation === startGeneration && !socket) busy = false;
      updateControls();
    }
  };
  const beginTakeover = (command) => {
    if (typeof command.token !== 'string' || !command.token || command.token.length > 256) return;
    if (takeover) return;
    const resume = mode === 'conversation' && (active || busy || Boolean(socket));
    // Retain only an established runtime; an in-flight microphone request cannot be transferred.
    if (starting) { stop(false, 'takeover'); setStatus('Server changed', 'Tap to start voice again.'); return; }
    takeover = { resume, token:command.token };
    clearTimeout(retryTimer); retryTimer = undefined; retryAttempt = 0; retryDetail = '';
    clearTimeout(staleEventsTimer); staleEventsTimer = undefined;
    resumeMuted = muted;
    active = false; busy = true; finishingDictation = false;
    const oldSocket = socket; socket = undefined;
    if (oldSocket?.readyState === WebSocket.OPEN) oldSocket.send(JSON.stringify({ type:'takeover.ack', token:command.token }));
    oldSocket?.close(1000, 'takeover');
    realtimeAudio?.setSpeakerSuppressed(true);
    if (!resume) closeHardware();
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', 'Stop voice');
    setStatus('Switching session…', resume ? 'Reconnecting voice to the new session…' : 'Waiting for the new session…');
    updateControls();
    takeoverTimer = setTimeout(() => {
      stop(false, 'takeover-timeout');
      setStatus('Could not reconnect', 'New session did not become ready. Check the server, then tap to start voice.');
    }, 20000);
  };
  const completeTakeover = (command) => {
    if (!takeover || command.takeoverToken !== takeover.token) return;
    const { resume, token } = takeover;
    clearTimeout(takeoverTimer); takeover = undefined; busy = false;
    if (resume) { replacingCall = true; void start(token); }
    else { stop(false, 'takeover-complete'); setStatus('Connected to the new session', mode === 'dictation' ? 'Tap to start dictation' : 'Tap to start voice'); }
  };
  const cancelFinishingDictation = () => {
    if (!finishingDictation) return;
    finishingDictation = false;
    active = false;
    busy = false;
    const currentSocket = socket;
    socket = undefined;
    if (currentSocket?.readyState === WebSocket.OPEN) currentSocket.send(JSON.stringify({ type:'cancel' }));
    currentSocket?.close(1000, 'dictation-cancelled');
    closeHardware();
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', 'Start dictation');
    setStatus('Tap to start dictation');
    updateControls();
  };
  const selectMode = (nextMode) => {
    if (active || busy || (nextMode !== 'conversation' && nextMode !== 'dictation')) return;
    mode = nextMode;
    modeButtons.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.mode === mode)));
    button.dataset.mode = mode;
    button.setAttribute('aria-label', mode === 'dictation' ? 'Start dictation' : 'Start voice');
    setStatus(mode === 'dictation' ? 'Tap to start dictation' : 'Tap to start voice');
  };

  button.addEventListener('click', () => {
    if (finishingDictation) cancelFinishingDictation();
    else if (active || busy || socket) stop();
    else void start();
  });
  muteButton.addEventListener('click', () => setMuted(!muted));
  modeButtons.forEach((item) => item.addEventListener('click', () => selectMode(item.dataset.mode)));
  updateControls();

  return {
    handleServerCommand(command) {
      if (command.type === 'connection') {
        if (command.state === 'connected') { clearTimeout(staleEventsTimer); staleEventsTimer = undefined; }
        if (command.state === 'reconnecting' && !staleEventsTimer && !retryAttempt && !takeover && mode === 'conversation' && (active || socket)) {
          staleEventsTimer = setTimeout(() => { staleEventsTimer = undefined; retryConnection('Server updates disconnected.'); }, 5000);
        }
        return;
      }
      if (command.type === 'takeover') { beginTakeover(command); return; }
      if (command.type === 'ready') { completeTakeover(command); return; }
      if (takeover) return;
      if (command.type === 'stop') stop(false, command.reason || 'server');
      if (command.type === 'error') connectionError(command.message);
      if (command.type === 'mute') setMuted(command.muted, false);
      if (command.type === 'status' && busy && !active && !retryTimer) setStatus(command.status === 'summarizing…' ? 'Summarizing conversation…' : 'Connecting…');
      if (command.type === 'microphone') { inputTooQuiet = command.state === 'too-quiet'; renderConversationStatus(); }
    },
    pagehide() {
      if (active) navigator.sendBeacon('/api/stop', new Blob([JSON.stringify({ clientId })], {type:'application/json'}));
      stop(false, 'pagehide');
    },
  };
}
`}`;
