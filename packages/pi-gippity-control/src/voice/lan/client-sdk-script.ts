import { LAN_VOICE_AUDIO_WORKLET } from "./audio-worklet.ts";
import { LAN_VOICE_MICROPHONE_BUFFER_WORKLET } from "./microphone-buffer-worklet.ts";

const AUDIO_WORKLET_SOURCE = JSON.stringify(LAN_VOICE_AUDIO_WORKLET);
const MICROPHONE_WORKLET_SOURCE = JSON.stringify(
	LAN_VOICE_MICROPHONE_BUFFER_WORKLET,
);

export const LAN_REMOTE_CLIENT_SCRIPT = String.raw`
(function (global) {
  'use strict';
  const audioWorkletSource = ${AUDIO_WORKLET_SOURCE};
  const microphoneWorkletSource = ${MICROPHONE_WORKLET_SOURCE};

  function id() {
    return global.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  async function createRealtimeAudio(stream) {
    const context = new AudioContext({ latencyHint:'interactive' });
    let source, microphoneBuffer, processor;
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
        releaseInput() { microphoneBuffer.port.postMessage({ type:'release' }); },
        play(pcm) { processor.port.postMessage(pcm, [pcm]); },
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

  function createAudio(client) {
    let socket, stream, context, source, processor, realtimeAudio;
    let mode = 'conversation';
    let active = false, muted = false, inputTooQuiet = false, busy = false, finishing = false, starting = false;
    let generation = 0;
    let state = 'idle', detail = '';

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
    const setMuted = (next, notify = true) => {
      if (notify && (!active || mode !== 'conversation')) return;
      muted = Boolean(next);
      stream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
      if (notify && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type:'mute', muted }));
	  if (!active) { client._emit('audio', snapshot()); return; }
      publish(muted ? 'muted' : 'listening', muted ? 'Voice remains connected' : (inputTooQuiet ? 'Microphone level is too low' : ''));
    };
    const finishStop = (notify, reason) => {
      active = false; muted = false; inputTooQuiet = false; finishing = false; busy = false;
      const current = socket; socket = undefined;
      if (notify && current?.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type:'release' }));
      if (notify) void client._post('/api/stop', { terminateConversation: mode === 'conversation' }).catch(() => {});
      current?.close(1000, reason);
      closeHardware();
      publish(reason === 'replaced' ? 'replaced' : 'idle', reason === 'replaced' ? 'Moved to another device' : '');
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
        if (message.type === 'stop') { finishStop(false, message.reason || 'server'); return; }
        if (message.type === 'mute') setMuted(message.muted, false);
        if (message.type === 'active') {
          active = true; busy = false; finishing = false;
          if (mode === 'conversation') {
            inputTooQuiet = false;
            if (typeof message.muted === 'boolean') muted = message.muted;
            realtimeAudio?.releaseInput();
          }
          publish(muted ? 'muted' : (mode === 'dictation' ? 'recording' : 'listening'));
        }
        if (message.type === 'dictation.complete') {
          finishing = false; busy = false; active = false;
          socket = undefined; current.close(1000, 'dictation-complete');
		  publish('idle'); client._emit('dictation.complete', message);
        }
        if (message.type === 'error') { finishStop(false, 'upstream-error'); publish('error', message.message || 'Voice failed'); }
      } catch {}
    };
    const start = async (nextMode = mode) => {
      if (nextMode !== 'conversation' && nextMode !== 'dictation') throw new Error('Audio mode must be conversation or dictation');
      if (starting || busy || active || socket) return;
      mode = nextMode;
      const currentGeneration = ++generation;
      starting = true; busy = true; publish('opening', 'Allow microphone access if asked.');
      try {
        if (!global.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS and certificate acceptance.');
        if (!global.AudioWorkletNode) throw new Error('This browser does not support the required low-latency audio runtime.');
        stream = await navigator.mediaDevices.getUserMedia({ audio:{ channelCount:1, echoCancellation:true, noiseSuppression:true, autoGainControl:true } });
        if (currentGeneration !== generation) { closeHardware(); return; }
        if (mode === 'conversation') {
          realtimeAudio = await createRealtimeAudio(stream);
          context = realtimeAudio.context; processor = realtimeAudio.processor;
        } else {
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
          finishStop(false, 'connect-timeout'); publish('error', 'Connection timed out.');
        }, 10000);
        processor.port.onmessage = (event) => {
          if (active && !muted && socket === current && current.readyState === WebSocket.OPEN && current.bufferedAmount < 65536) current.send(event.data);
        };
        current.onopen = () => {
          if (socket !== current || !context) return;
          clearTimeout(timer); current.send(JSON.stringify({ type:'start', mode })); publish('connecting');
        };
        current.onmessage = (event) => receive(current, event);
        current.onclose = (event) => {
          clearTimeout(timer);
          if (socket === current) finishStop(false, event.reason || 'connection-closed');
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
    const serverCommand = (command) => {
      if (command.type === 'stop') finishStop(false, command.reason || 'server');
      if (command.type === 'error' && (active || busy || socket)) { finishStop(false, 'server-error'); publish('error', command.message); }
      if (command.type === 'mute') setMuted(command.muted, false);
      if (command.type === 'status' && busy && !active) publish(command.status === 'summarizing…' ? 'summarizing' : 'connecting');
      if (command.type === 'microphone') { inputTooQuiet = command.state === 'too-quiet'; if (active && !muted) publish('listening', inputTooQuiet ? 'Microphone level is too low' : ''); }
    };
    return {
      start, stop,
      setMuted,
      get state() { return snapshot(); },
      _serverCommand: serverCommand,
      _pagehide() {
        stream?.getTracks().forEach((track) => track.stop());
        if (active) navigator.sendBeacon('/api/stop', new Blob([JSON.stringify({ clientId:client.clientId })], {type:'application/json'}));
      },
      _close() { generation += 1; finishStop(true, 'client-closed'); },
    };
  }

  function connect(options = {}) {
    const clientId = options.clientId || id();
    const listeners = new Map();
    let closed = false, eventSource, rpcId = 0;
    let draft = { type:'draft', text:'', revision:-1 };
    let dirty = false, syncing = false, syncPromise, timer;

    const emit = (type, value) => {
      for (const listener of listeners.get(type) || []) { try { listener(value); } catch (error) { setTimeout(() => { throw error; }); } }
      if (type !== '*') for (const listener of listeners.get('*') || []) { try { listener(value); } catch (error) { setTimeout(() => { throw error; }); } }
    };
    const post = async (path, body) => {
      const response = await fetch(path, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ clientId, ...body }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Pi rejected the request');
      return result;
    };
    const client = {
      clientId,
      _emit: emit,
      _post: post,
      get draft() { return { ...draft }; },
      on(type, listener) {
        if (typeof listener !== 'function') throw new Error('Event listener must be a function');
        let group = listeners.get(type); if (!group) { group = new Set(); listeners.set(type, group); }
        group.add(listener); return () => group.delete(listener);
      },
      async call(target, method, ...args) {
        const id = ++rpcId;
        const result = await post('/api/rpc', { id, target, method, args });
        if (!result.ok) {
          const error = new Error(result.error?.message || 'Pi RPC failed');
          if (result.error?.name) error.name = result.error.name;
          throw error;
        }
        return result.result;
      },
      setDraft(text) {
        if (typeof text !== 'string') throw new Error('Draft text must be a string');
        draft = { ...draft, text, local:true };
        dirty = true; emit('draft', { ...draft });
        clearTimeout(timer); timer = setTimeout(() => { void flush().catch(() => {}); }, 180);
      },
      flushDraft: () => flush(),
      async send(text) {
        if (typeof text === 'string' && text !== draft.text) client.setDraft(text);
        clearTimeout(timer);
        await flush();
        if (!draft.text.trim()) throw new Error('A message is required');
        await post('/api/send', { text:draft.text, revision:draft.revision });
      },
      close() {
        if (closed) return; closed = true; clearTimeout(timer);
        navigator.sendBeacon('/api/draft', new Blob([JSON.stringify({ clientId, text:draft.text, revision:draft.revision })], {type:'application/json'}));
        client.audio._close(); eventSource?.close(); listeners.clear();
      },
    };
    const flush = async () => {
      if (syncing) return syncPromise;
      if (!dirty || draft.revision < 0) return true;
      syncing = true;
      syncPromise = (async () => {
        while (dirty) {
          dirty = false;
          const text = draft.text;
          try {
            const result = await post('/api/draft', { text, revision:draft.revision });
            if (typeof result.revision === 'number') draft = { ...draft, revision:Math.max(draft.revision, result.revision) };
          } catch (error) {
            dirty = true; emit('error', { type:'error', source:'draft', message:error instanceof Error ? error.message : String(error) });
            throw error;
          }
        }
        return true;
      })();
      try { return await syncPromise; }
      finally { syncing = false; syncPromise = undefined; }
    };
    const applyDraft = (command) => {
      if (typeof command.text !== 'string' || typeof command.revision !== 'number' || command.revision < draft.revision) return;
      const preserveLocal = command.sourceClientId === clientId && command.reason === 'update' && (dirty || syncing) && draft.text !== command.text;
      draft = preserveLocal ? { ...draft, revision:command.revision } : { ...command };
      if (command.sourceClientId !== clientId) { clearTimeout(timer); dirty = false; }
      emit('draft', { ...draft });
    };
    client.audio = createAudio(client);
    eventSource = new EventSource('/api/events?client=' + encodeURIComponent(clientId));
    eventSource.onopen = () => emit('connection', { type:'connection', state:'connected' });
    eventSource.onerror = () => emit('connection', { type:'connection', state:'reconnecting' });
    eventSource.onmessage = (event) => {
      try {
        const command = JSON.parse(event.data);
        client.audio._serverCommand(command);
        if (command.type === 'draft') applyDraft(command);
        else emit(command.type, command);
        if (command.type === 'pi.event') emit('pi:' + command.event, command.data);
      } catch {}
    };
    global.addEventListener('pagehide', () => { client.audio._pagehide(); clearTimeout(timer); navigator.sendBeacon('/api/draft', new Blob([JSON.stringify({ clientId, text:draft.text, revision:draft.revision })], {type:'application/json'})); }, { once:true });
    return client;
  }

  global.GippityRemote = Object.freeze({ connect });
})(globalThis);
`;
