import { LAN_VOICE_AUDIO_WORKLET } from "./audio-worklet.ts";

const AUDIO_WORKLET_SOURCE = JSON.stringify(LAN_VOICE_AUDIO_WORKLET);

export const LAN_VOICE_BROWSER_AUDIO_SCRIPT = String.raw`
function createAudioController({ button, audioState, audioDetail, modeButtons, composer, clientId }) {
  let socket;
  let stream;
  let context;
  let source;
  let processor;
  let mode = 'conversation';
  let active = false;
  let busy = false;
  let finishingDictation = false;

  const setStatus = (title, message = '') => { audioState.textContent = title; audioDetail.textContent = message; };
  const updateControls = () => {
    button.disabled = busy && !socket;
    button.setAttribute('aria-busy', String(busy));
    modeButtons.forEach((item) => { item.disabled = busy || active; });
  };
  const closeHardware = async () => {
    processor?.disconnect(); processor = undefined;
    source?.disconnect(); source = undefined;
    stream?.getTracks().forEach((track) => track.stop()); stream = undefined;
    const currentContext = context; context = undefined;
    await currentContext?.close().catch(() => {});
  };
  const stop = async (notify = true, reason = 'user') => {
    if (notify && active && mode === 'dictation' && socket?.readyState === WebSocket.OPEN) {
      const finishingSocket = socket;
      const draft = composer.snapshot();
      active = false;
      busy = true;
      finishingDictation = true;
      socket.send(JSON.stringify({ type:'finish', draft:draft.text, revision:draft.revision, selectionStart:draft.selectionStart, selectionEnd:draft.selectionEnd }));
      await closeHardware();
      if (!finishingDictation || socket !== finishingSocket) return;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', 'Cancel transcription');
      setStatus('Transcribing…');
      updateControls();
      return;
    }
    active = false;
    finishingDictation = false;
    const currentSocket = socket;
    socket = undefined;
    if (notify && currentSocket?.readyState === WebSocket.OPEN) currentSocket.send(JSON.stringify({ type:'release' }));
    currentSocket?.close(1000, reason);
    await closeHardware();
    busy = false;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', mode === 'dictation' ? 'Start dictation' : 'Start voice');
    if (reason === 'replaced') {
      setStatus('Moved to another device', 'Tap to take control here');
    } else if (reason !== 'upstream-error' && reason !== 'server-error' && reason !== 'dictation-complete') {
      setStatus(mode === 'dictation' ? 'Tap to start dictation' : 'Tap to start voice');
    }
    updateControls();
  };
  const receiveMessage = (currentSocket, event) => {
    if (socket !== currentSocket) return;
    if (event.data instanceof ArrayBuffer) {
      if (mode === 'conversation') processor?.port.postMessage(event.data, [event.data]);
      return;
    }
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'active') {
        active = true;
        busy = false;
        finishingDictation = false;
        button.setAttribute('aria-pressed', 'true');
        button.setAttribute('aria-label', mode === 'dictation' ? 'Finish dictation' : 'Stop voice');
        setStatus(mode === 'dictation' ? 'Recording' : 'Listening', mode === 'dictation' ? 'Tap to finish' : 'Tap to stop');
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
      if (message.type === 'error') { void stop(false, 'upstream-error'); setStatus('Could not start', message.message); }
    } catch {}
  };
  const start = async () => {
    if (busy || active) return;
    busy = true;
    updateControls();
    setStatus('Opening microphone…', 'Allow microphone access if asked.');
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
      updateControls();
      const connectTimer = setTimeout(() => {
        if (socket !== currentSocket || currentSocket.readyState !== WebSocket.CONNECTING) return;
        void stop(false, 'connect-timeout');
        setStatus('Could not start', 'Connection timed out. Tap to retry.');
      }, 10000);
      processor.port.onmessage = (event) => {
        if (active && socket === currentSocket && currentSocket.readyState === WebSocket.OPEN && currentSocket.bufferedAmount < 65536) currentSocket.send(event.data);
      };
      currentSocket.onopen = () => {
        if (socket !== currentSocket || !context) return;
        clearTimeout(connectTimer);
        currentSocket.send(JSON.stringify({ type:'start', mode }));
        setStatus('Connecting…');
      };
      currentSocket.onmessage = (event) => receiveMessage(currentSocket, event);
      currentSocket.onclose = (event) => {
        clearTimeout(connectTimer);
        if (socket === currentSocket) void stop(false, event.reason || 'connection-closed');
      };
    } catch (error) {
      await stop(false, 'start-error');
      setStatus('Could not start', error instanceof Error ? error.message : String(error));
    } finally {
      if (!socket) busy = false;
      updateControls();
    }
  };
  const cancelFinishingDictation = async () => {
    if (!finishingDictation) return;
    finishingDictation = false;
    active = false;
    busy = false;
    const currentSocket = socket;
    socket = undefined;
    if (currentSocket?.readyState === WebSocket.OPEN) currentSocket.send(JSON.stringify({ type:'cancel' }));
    currentSocket?.close(1000, 'dictation-cancelled');
    await closeHardware();
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
    if (finishingDictation) void cancelFinishingDictation();
    else if (active || (busy && socket)) void stop();
    else void start();
  });
  modeButtons.forEach((item) => item.addEventListener('click', () => selectMode(item.dataset.mode)));
  updateControls();

  return {
    handleServerCommand(command) {
      if (command.type === 'stop') void stop(false, command.reason || 'server');
      if (command.type === 'error') { void stop(false, 'server-error'); setStatus('Voice stopped', command.message); }
    },
    pagehide() {
      stream?.getTracks().forEach((track) => track.stop());
      if (active) navigator.sendBeacon('/api/stop', new Blob([JSON.stringify({ clientId })], {type:'application/json'}));
    },
  };
}
`;
