import { LAN_VOICE_AUDIO_WORKLET } from "./audio-worklet.ts";
import { LAN_VOICE_MICROPHONE_BUFFER_WORKLET } from "./microphone-buffer-worklet.ts";

const AUDIO_WORKLET_SOURCE = JSON.stringify(LAN_VOICE_AUDIO_WORKLET);
const MICROPHONE_WORKLET_SOURCE = JSON.stringify(
	LAN_VOICE_MICROPHONE_BUFFER_WORKLET,
);

export const LAN_REMOTE_AUDIO_SCRIPT = String.raw`  const audioWorkletSource = ${AUDIO_WORKLET_SOURCE};
  const microphoneWorkletSource = ${MICROPHONE_WORKLET_SOURCE};

  function id() {
    return global.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  async function createRealtimeAudio(stream) {
    const context = new AudioContext({ latencyHint:'interactive' });
    let source, microphoneBuffer, processor;
    let inputEpoch = 0, speakerSuppressed = false;
    try {
      const microphoneUrl = URL.createObjectURL(new Blob([microphoneWorkletSource], { type:'text/javascript' }));
      const audioUrl = URL.createObjectURL(new Blob([audioWorkletSource], { type:'text/javascript' }));
      try { await Promise.all([context.audioWorklet.addModule(microphoneUrl), context.audioWorklet.addModule(audioUrl)]); }
      finally { URL.revokeObjectURL(microphoneUrl); URL.revokeObjectURL(audioUrl); }
      await context.resume();
      if (context.state !== 'running') throw new Error('Browser audio did not start. Check its media permissions.');
      source = context.createMediaStreamSource(stream);
      microphoneBuffer = new AudioWorkletNode(context, 'pi-lan-microphone-buffer', { channelCount:1, channelCountMode:'explicit', outputChannelCount:[1] });
      processor = new AudioWorkletNode(context, 'pi-lan-voice', { numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1] });
      source.connect(microphoneBuffer);
      microphoneBuffer.connect(processor);
      processor.connect(context.destination);
      return {
        context, processor,
        acceptCapture(value) { return value?.type === 'capture' && value.epoch === inputEpoch && value.pcm instanceof ArrayBuffer ? value.pcm : undefined; },
        releaseInput() { microphoneBuffer.port.postMessage({ type:'release' }); },
        setInputMuted(muted) {
          inputEpoch += 1;
          const command = { type:'input_muted', muted:Boolean(muted), epoch:inputEpoch };
          microphoneBuffer.port.postMessage(command);
          processor.port.postMessage(command);
        },
        setSpeakerSuppressed(suppressed) {
          const next = Boolean(suppressed);
          if (speakerSuppressed === next) return;
          speakerSuppressed = next;
          processor.port.postMessage({ type:'speaker_suppressed', suppressed:next });
        },
        play(pcm) { if (!speakerSuppressed) processor.port.postMessage(pcm, [pcm]); },
        close() {
          processor.disconnect(); microphoneBuffer.disconnect(); source.disconnect();
          void context.close().catch(() => {});
        },
      };
    } catch (error) {
      processor?.disconnect(); microphoneBuffer?.disconnect(); source?.disconnect();
      await context.close().catch(() => {});
      throw error;
    }
  }

  function createAudio(client, assertOpen) {
    let socket, stream, context, source, processor, realtimeAudio;
    let mode = 'conversation';
    let active = false, muted = false, inputTooQuiet = false, busy = false, finishing = false, starting = false;
    let generation = 0;
    let state = 'idle', detail = '';
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
        finishStop(false, 'connection-failed');
        publish('error', failure + ' Check the connection, then start voice again.');
        return;
      }
      resumeMuted = muted;
      active = false; busy = true;
      const previous = socket; socket = undefined;
      previous?.close(1000, 'reconnecting');
      realtimeAudio?.setSpeakerSuppressed(true);
      const delay = 1000 * 2 ** retryAttempt++;
      retryTimer = setTimeout(() => {
        retryTimer = undefined; busy = false;
        void start('conversation');
      }, delay);
      publish('reconnecting', detail + ' Retry ' + retryAttempt + '/3 in ' + delay / 1000 + 's. Stop to cancel.');
    };
    const connectionError = (message) => {
      if (mode === 'conversation' && (active || busy || socket)) { retryConnection(message || 'Voice failed.'); return; }
      finishStop(false, 'upstream-error'); publish('error', message || 'Voice failed');
    };

    const snapshot = () => ({ type:'audio', mode, active, busy, muted, inputTooQuiet, state, detail });
    const publish = (nextState, nextDetail = '') => {
      if (nextState) state = nextState;
      detail = nextDetail;
      client._emit('audio', snapshot());
    };
    const closeHardware = () => {
      const currentRealtime = realtimeAudio; realtimeAudio = undefined;
      if (currentRealtime) currentRealtime.close();
      else { processor?.disconnect(); source?.disconnect(); void context?.close().catch(() => {}); }
      processor = undefined; source = undefined; context = undefined;
      stream?.getTracks().forEach((track) => track.stop()); stream = undefined;
    };
    const setMuted = (next, notify = true, synchronize = false) => {
      if (notify && (!active || mode !== 'conversation')) return;
      const nextMuted = Boolean(next);
      if (muted !== nextMuted || synchronize) realtimeAudio?.setInputMuted(nextMuted);
      muted = nextMuted;
      stream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
      if (notify && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type:'mute', muted }));
	  if (!active) { client._emit('audio', snapshot()); return; }
      publish(muted ? 'muted' : 'listening', muted ? 'Voice remains connected' : (inputTooQuiet ? 'Microphone level is too low' : ''));
    };
    const finishStop = (notify, reason) => {
      generation += 1;
      if (takeover) notify = false;
      clearTimeout(takeoverTimer); takeover = undefined; resumeMuted = false; replacingCall = false;
      clearTimeout(retryTimer); retryTimer = undefined; retryAttempt = 0; retryDetail = '';
      clearTimeout(staleEventsTimer); staleEventsTimer = undefined;
      active = false; muted = false; inputTooQuiet = false; finishing = false; busy = false;
      const current = socket; socket = undefined;
      if (notify && current?.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type:'release' }));
      if (notify) void client._post('/api/stop', { terminateConversation: mode === 'conversation' }).catch(() => {});
      current?.close(1000, reason);
      closeHardware();
      publish(reason === 'replaced' ? 'replaced' : reason === 'transfer-ended' ? 'transfer-ended' : 'idle',
        reason === 'replaced' ? 'Moved to another device' : reason === 'transfer-ended' ? 'Start voice to return to this session' : '');
    };
    const stop = (draftSnapshot, notify = true, reason = 'user') => {
      generation += 1;
	  if (finishing) {
		finishing = false; busy = false;
		const current = socket; socket = undefined;
		if (current?.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type:'cancel' }));
		current?.close(1000, 'dictation-cancelled'); closeHardware(); publish('idle');
		return;
	  }
      if (notify && active && mode === 'dictation' && socket?.readyState === WebSocket.OPEN) {
        const draft = draftSnapshot ?? client.draft;
        active = false; busy = true; finishing = true;
        socket.send(JSON.stringify({
          type:'finish', draft:draft.text, revision:draft.revision,
          selectionStart:draft.selectionStart ?? draft.text.length,
          selectionEnd:draft.selectionEnd ?? draft.text.length,
        }));
        closeHardware();
        publish('transcribing');
        return;
      }
      finishStop(notify, reason);
    };
    const receive = (current, event) => {
      if (socket !== current) return;
      if (event.data instanceof ArrayBuffer) { realtimeAudio?.play(event.data); return; }
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'takeover') { beginTakeover(message); return; }
        if (message.type === 'stop') { finishStop(false, message.reason || 'server'); return; }
        if (message.type === 'mute') setMuted(message.muted, false);
        if (message.type === 'speaker_suppressed') realtimeAudio?.setSpeakerSuppressed(message.suppressed);
        if (message.type === 'active') {
          const resuming = retryAttempt > 0 || replacingCall;
          retryAttempt = 0;
          retryDetail = '';
          replacingCall = false;
          active = true; busy = false; finishing = false;
          if (mode === 'conversation') {
            inputTooQuiet = false;
            const initialMuted = resuming ? resumeMuted : (typeof message.muted === 'boolean' ? message.muted : muted);
            setMuted(initialMuted, false, initialMuted);
            if (resuming) current.send(JSON.stringify({ type:'mute', muted:initialMuted }));
            resumeMuted = false;
            realtimeAudio?.setSpeakerSuppressed(Boolean(message.speakerSuppressed));
            if (!initialMuted) realtimeAudio?.releaseInput();
          }
          publish(muted ? 'muted' : (mode === 'dictation' ? 'recording' : 'listening'));
        }
        if (message.type === 'dictation.complete') {
          finishing = false; busy = false; active = false;
          socket = undefined; current.close(1000, 'dictation-complete');
		  publish('idle'); client._emit('dictation.complete', message);
        }
        if (message.type === 'error') connectionError(message.message);
      } catch {}
    };
    const start = async (nextMode = mode, takeoverToken) => {
      if (nextMode !== 'conversation' && nextMode !== 'dictation') throw new Error('Audio mode must be conversation or dictation');
      if (starting || busy || active || socket) return;
      mode = nextMode;
      if (mode === 'dictation') muted = false;
      const currentGeneration = ++generation;
      starting = true; busy = true; publish(realtimeAudio ? 'connecting' : 'opening', realtimeAudio ? '' : 'Allow microphone access if asked.');
      try {
        if (currentGeneration !== generation) return;
        if (!global.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS and certificate acceptance.');
        if (!global.AudioWorkletNode) throw new Error('This browser does not support the required low-latency audio runtime.');
        if (!stream?.getAudioTracks().some((track) => track.readyState === 'live')) {
          closeHardware();
          stream = await navigator.mediaDevices.getUserMedia({ audio:{ channelCount:1, echoCancellation:true, noiseSuppression:true, autoGainControl:true } });
        }
        if (currentGeneration !== generation) { closeHardware(); return; }
        if (mode === 'conversation' && !realtimeAudio) {
          realtimeAudio = await createRealtimeAudio(stream);
          context = realtimeAudio.context; processor = realtimeAudio.processor;
        } else if (mode === 'dictation') {
          context = new AudioContext({ latencyHint:'interactive' });
          const workletUrl = URL.createObjectURL(new Blob([audioWorkletSource], { type:'text/javascript' }));
          try { await context.audioWorklet.addModule(workletUrl); }
          finally { URL.revokeObjectURL(workletUrl); }
          if (currentGeneration !== generation) { closeHardware(); return; }
          await context.resume();
          if (context.state !== 'running') throw new Error('Browser audio did not start. Check its media permissions.');
          source = context.createMediaStreamSource(stream);
          processor = new AudioWorkletNode(context, 'pi-lan-voice', { numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1] });
          source.connect(processor); processor.connect(context.destination);
        }
        if (currentGeneration !== generation) { closeHardware(); return; }
        const current = new WebSocket('wss://' + location.host + '/api/audio?client=' + encodeURIComponent(client.clientId));
        current.binaryType = 'arraybuffer'; socket = current;
        const timer = setTimeout(() => {
          if (socket !== current || current.readyState !== WebSocket.CONNECTING) return;
          if (mode === 'conversation') { retryConnection('Connection timed out.'); return; }
          finishStop(false, 'connect-timeout'); publish('error', 'Connection timed out.');
        }, 10000);
        processor.port.onmessage = (event) => {
          const pcm = realtimeAudio
            ? realtimeAudio.acceptCapture(event.data)
            : event.data?.type === 'capture' && event.data.epoch === 0 && event.data.pcm instanceof ArrayBuffer ? event.data.pcm : undefined;
          if (pcm && active && !muted && socket === current && current.readyState === WebSocket.OPEN && current.bufferedAmount < 65536) current.send(pcm);
        };
        current.onopen = () => {
          if (socket !== current || !context) return;
          clearTimeout(timer); current.send(JSON.stringify({ type:'start', mode, ...(takeoverToken ? { takeoverToken } : {}) })); publish('connecting');
        };
        current.onmessage = (event) => receive(current, event);
        current.onclose = (event) => {
          clearTimeout(timer);
          if (socket !== current) return;
          if (mode === 'conversation' && ![1002, 1003, 1007, 1008, 1009, 4001].includes(event.code)) { retryConnection('Voice connection lost.'); return; }
          const failedTakeover = replacingCall || retryAttempt > 0;
          const detail = event.reason || 'Voice connection closed unexpectedly (' + event.code + ').';
          finishStop(false, 'connection-closed'); publish('error', failedTakeover ? 'Check the server and connection, then start voice again.' : detail);
        };
      } catch (error) {
        if (currentGeneration !== generation) return;
        finishStop(false, 'start-error'); publish('error', error instanceof Error ? error.message : String(error));
      } finally {
        starting = false;
        if (currentGeneration === generation && !socket) busy = false;
        client._emit('audio', snapshot());
      }
    };
    const beginTakeover = (command) => {
      if (typeof command.token !== 'string' || !command.token || command.token.length > 256 || takeover) return;
      const resume = mode === 'conversation' && (active || busy || Boolean(socket));
      // Only an established audio runtime can be retained across replacement.
      if (starting) { stop(undefined, false, 'takeover'); publish('error', 'Server changed during startup. Start voice again.'); return; }
      takeover = { resume, token:command.token };
      clearTimeout(retryTimer); retryTimer = undefined; retryAttempt = 0; retryDetail = '';
      clearTimeout(staleEventsTimer); staleEventsTimer = undefined;
      resumeMuted = muted;
      active = false; busy = true; finishing = false;
      const oldSocket = socket; socket = undefined;
      if (oldSocket?.readyState === WebSocket.OPEN) oldSocket.send(JSON.stringify({ type:'takeover.ack', token:command.token }));
      oldSocket?.close(1000, 'takeover');
      realtimeAudio?.setSpeakerSuppressed(true);
      if (!resume) closeHardware();
      takeoverTimer = setTimeout(() => {
        finishStop(false, 'takeover-timeout');
        publish('error', 'New session did not become ready. Check the server, then start voice again.');
      }, 20000);
      publish('takeover', resume ? 'Reconnecting voice to the new session…' : 'Waiting for the new session…');
    };
    const completeTakeover = (command) => {
      if (!takeover || command.takeoverToken !== takeover.token) return;
      const { resume, token } = takeover;
      clearTimeout(takeoverTimer); takeover = undefined; busy = false;
      if (resume) { replacingCall = true; void start('conversation', token); }
      else { resumeMuted = false; publish('idle', 'Connected to the new session'); }
    };
    const serverCommand = (command) => {
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
      if (command.type === 'stop') finishStop(false, command.reason || 'server');
      if (command.type === 'error' && (active || busy || socket)) connectionError(command.message);
      if (command.type === 'mute' && mode === 'conversation') setMuted(command.muted, false);
      if (command.type === 'status' && busy && !active && !retryTimer) publish(command.status === 'summarizing…' ? 'summarizing' : 'connecting');
      if (command.type === 'microphone') { inputTooQuiet = command.state === 'too-quiet'; if (active && !muted) publish('listening', inputTooQuiet ? 'Microphone level is too low' : ''); }
    };
    return {
      start(...args) { assertOpen(); return start(...args); },
      stop(...args) { assertOpen(); return stop(...args); },
      setMuted(...args) { assertOpen(); return setMuted(...args); },
      get state() { return snapshot(); },
      _serverCommand: serverCommand,
      _pagehide() {
		if (finishing && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type:'cancel' }));
		else if (active) navigator.sendBeacon('/api/stop', new Blob([JSON.stringify({ clientId:client.clientId })], {type:'application/json'}));
        generation += 1; finishStop(false, 'pagehide');
      },
	  _close() { if (finishing) stop(); else { generation += 1; finishStop(true, 'client-closed'); } },
    };
  }

`;
