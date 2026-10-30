import { LAN_REMOTE_AUDIO_SCRIPT } from "./client-audio-script.ts";

export const LAN_REMOTE_CLIENT_SCRIPT = String.raw`
(function (global) {
  'use strict';
${LAN_REMOTE_AUDIO_SCRIPT}  function connect(options = {}) {
    const clientId = options.clientId || id();
    const listeners = new Map();
    let closed = false, eventSource, rpcId = 0;
    let draft = { type:'draft', text:'', revision:-1 };
    let dirty = false, syncing = false, syncPromise, timer;
	let resolveInitialDraft;
	const initialDraft = new Promise((resolve) => { resolveInitialDraft = resolve; });
	const assertOpen = () => { if (closed) throw new Error('GipPity remote is closed'); };

    const emit = (type, value, wildcard = true) => {
      for (const listener of listeners.get(type) || []) { try { listener(value); } catch (error) { setTimeout(() => { throw error; }); } }
	  if (wildcard && type !== '*') for (const listener of listeners.get('*') || []) { try { listener(value); } catch (error) { setTimeout(() => { throw error; }); } }
    };
    const post = async (path, body) => {
      assertOpen();
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
        assertOpen();
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
        assertOpen();
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
        if (closed) return; clearTimeout(timer);
        client.audio._close(); closed = true; resolveInitialDraft();
        navigator.sendBeacon('/api/draft', new Blob([JSON.stringify({ clientId, text:draft.text, revision:draft.revision })], {type:'application/json'}));
		global.removeEventListener('pagehide', pagehide);
        eventSource?.close(); listeners.clear();
      },
    };
    const flush = async () => {
	  if (closed) throw new Error('GipPity remote is closed');
      if (syncing) return syncPromise;
	  if (!dirty) return true;
      syncing = true;
      syncPromise = (async () => {
		if (draft.revision < 0) await initialDraft;
		if (closed) throw new Error('GipPity remote is closed');
        while (dirty) {
		  if (closed) throw new Error('GipPity remote is closed');
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
	  if (draft.revision < 0 && dirty) {
		draft = { ...draft, revision:command.revision };
		resolveInitialDraft(); emit('draft', { ...draft }); return;
	  }
	  const reconnectSnapshot = !command.sourceClientId && !command.reason;
	  const preserveLocal = (dirty || syncing) && draft.text !== command.text && (reconnectSnapshot || (command.sourceClientId === clientId && (command.reason === 'update' || command.reason === 'sent')));
      draft = preserveLocal ? { ...draft, revision:command.revision } : { ...command };
	  if (!preserveLocal && command.sourceClientId !== clientId) { clearTimeout(timer); dirty = false; }
	  if (reconnectSnapshot && preserveLocal && dirty) { clearTimeout(timer); timer = setTimeout(() => { void flush().catch(() => {}); }, 180); }
	  resolveInitialDraft();
      emit('draft', { ...draft });
    };
    client.audio = createAudio(client, assertOpen);
    eventSource = new EventSource('/api/events?client=' + encodeURIComponent(clientId));
    const connectionState = (state) => {
      const command = { type:'connection', state };
      client.audio._serverCommand(command); emit('connection', command);
    };
    eventSource.onopen = () => connectionState('connected');
    eventSource.onerror = () => connectionState('reconnecting');
    eventSource.onmessage = (event) => {
      try {
        const command = JSON.parse(event.data);
        client.audio._serverCommand(command);
        if (command.type === 'draft') applyDraft(command);
        else emit(command.type, command);
		if (command.type === 'pi.event') emit('pi:' + command.event, command.data, false);
      } catch {}
    };
	const pagehide = () => { client.audio._pagehide(); clearTimeout(timer); navigator.sendBeacon('/api/draft', new Blob([JSON.stringify({ clientId, text:draft.text, revision:draft.revision })], {type:'application/json'})); };
	global.addEventListener('pagehide', pagehide);
    return client;
  }

  global.GippityRemote = Object.freeze({ connect });
})(globalThis);
`;
