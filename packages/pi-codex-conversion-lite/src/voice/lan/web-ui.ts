import { LAN_VOICE_AUDIO_WORKLET } from "./audio-worklet.ts";

const AUDIO_WORKLET_SOURCE = JSON.stringify(LAN_VOICE_AUDIO_WORKLET);

export const LAN_VOICE_WEB_UI = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#171713">
  <title>Pi voice</title>
  <style>
    :root { color-scheme:dark; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#171713; color:#f3f1e8; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100svh; display:grid; place-items:center; padding:24px; background:radial-gradient(circle at 50% 25%,#29291f 0,#171713 48%,#10100e 100%); }
    main { width:min(100%,420px); display:grid; justify-items:center; gap:28px; text-align:center; }
    header { display:grid; gap:8px; }
    h1 { margin:0; font:600 clamp(28px,8vw,44px)/1 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:-.06em; }
    .eyebrow { margin:0; color:#a6a58f; font-size:13px; letter-spacing:.13em; text-transform:uppercase; }
    #voice { width:176px; height:176px; border:1px solid #545441; border-radius:50%; display:grid; place-items:center; cursor:pointer; color:#171713; background:#d8ff72; box-shadow:0 18px 50px #0007,inset 0 1px #fff8; transition:transform 160ms ease,background 160ms ease,box-shadow 160ms ease; }
    #voice:hover { transform:translateY(-2px); box-shadow:0 22px 60px #0008,inset 0 1px #fff8; }
    #voice:active { transform:scale(.98); }
    #voice[aria-pressed="true"] { color:#f3f1e8; background:#d35d43; border-color:#ef896f; box-shadow:0 0 0 10px #d35d4320,0 18px 50px #0008; }
    #voice:disabled { cursor:wait; opacity:.65; transform:none; }
    #voice svg { width:54px; height:54px; fill:currentColor; }
    .status { min-height:62px; display:grid; gap:8px; align-content:start; }
    #state { margin:0; font-weight:650; font-size:18px; }
    #detail { margin:0; color:#a6a58f; font-size:14px; line-height:1.5; }
    .connection { display:flex; align-items:center; gap:8px; color:#828274; font-size:12px; }
    .dot { width:7px; height:7px; border-radius:50%; background:#6a6a60; }
    .connection.online .dot { background:#d8ff72; box-shadow:0 0 12px #d8ff72aa; }
    .connection.online { color:#b8b7a5; }
    @media (prefers-reduced-motion:reduce) { #voice { transition:none; } }
  </style>
</head>
<body>
  <main>
    <header><p class="eyebrow">LAN companion</p><h1>Pi voice</h1></header>
    <button id="voice" type="button" aria-pressed="false" aria-label="Start voice">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V5a3.5 3.5 0 1 0-7 0v7a3.5 3.5 0 0 0 3.5 3.5Zm-1-10.5a1 1 0 0 1 2 0v7a1 1 0 1 1-2 0V5Zm7 6a1 1 0 0 1 1 1 7 7 0 0 1-6 6.92V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.08A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 0 0 10 0 1 1 0 0 1 1-1Z"/></svg>
    </button>
    <section class="status" aria-live="polite"><p id="state">Ready</p><p id="detail">Tap to speak with this Pi session.</p></section>
    <div id="connection" class="connection"><span class="dot"></span><span>Connecting to Pi</span></div>
  </main>
  <script>
    const button = document.querySelector('#voice');
    const state = document.querySelector('#state');
    const detail = document.querySelector('#detail');
    const connection = document.querySelector('#connection');
    const clientId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
    let socket;
    let stream;
    let context;
    let source;
    let processor;
    let active = false;
    let busy = false;

    const setStatus = (title, message) => { state.textContent = title; detail.textContent = message; };
    const errorData = (error) => error instanceof Error ? { name:error.name, message:error.message, stack:error.stack, cause:error.cause } : { value:String(error) };
    const report = (event, data) => {
      void fetch('/api/debug', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ clientId, event, data }), keepalive:true }).catch(() => {});
    };
    const events = new EventSource('/api/events?client=' + encodeURIComponent(clientId));
    events.onopen = () => { connection.classList.add('online'); connection.lastElementChild.textContent = 'Connected to Pi'; report('sse.open'); };
    events.onerror = () => { connection.classList.remove('online'); connection.lastElementChild.textContent = 'Reconnecting to Pi'; report('sse.error', { readyState:events.readyState }); };
    events.onmessage = (event) => {
      try {
        const command = JSON.parse(event.data);
        report('sse.message', command);
        if (command.type === 'stop') void stop(false, command.reason || 'server');
        if (command.type === 'error') { void stop(false, 'server-error'); setStatus('Voice stopped', command.message); }
      } catch (error) { report('sse.message_error', errorData(error)); }
    };

    async function start() {
      if (busy || active) return;
      busy = true;
      button.disabled = true;
      setStatus('Opening microphone…', 'Use the browser prompt to allow audio.');
      report('call.start_requested');
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
        processor.port.onmessage = (event) => {
          if (active && socket === currentSocket && currentSocket.readyState === WebSocket.OPEN && currentSocket.bufferedAmount < 65536) currentSocket.send(event.data);
        };
        currentSocket.onopen = () => { report('audio_socket.open', { sampleRate:context.sampleRate }); currentSocket.send(JSON.stringify({ type:'start' })); setStatus('Connecting…', 'Keeping your existing voice conversation.'); };
        currentSocket.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) { processor?.port.postMessage(event.data, [event.data]); return; }
          try {
            const message = JSON.parse(event.data);
            report('audio_socket.message', message);
            if (message.type === 'active') {
              active = true;
              button.setAttribute('aria-pressed', 'true');
              button.setAttribute('aria-label', 'Stop voice');
              setStatus('Listening', 'Speak naturally. Tap again to stop.');
            }
            if (message.type === 'error') { void stop(false, 'upstream-error'); setStatus('Could not start', message.message); }
          } catch (error) { report('audio_socket.message_error', errorData(error)); }
        };
        currentSocket.onerror = (event) => report('audio_socket.error', { type:event.type });
        currentSocket.onclose = (event) => {
          report('audio_socket.close', { code:event.code, reason:event.reason });
          if (socket === currentSocket) void stop(false, event.reason || 'connection-closed');
        };
        report('microphone.opened', { sampleRate:context.sampleRate, tracks:stream.getAudioTracks().map((track) => ({ label:track.label, settings:track.getSettings?.() })) });
      } catch (error) {
        report('call.start_error', errorData(error));
        await stop(false, 'start-error');
        setStatus('Could not start', error instanceof Error ? error.message : String(error));
      } finally {
        busy = false;
        button.disabled = false;
      }
    }

    async function stop(notify = true, reason = 'user') {
      report('call.stop', { notify, reason, active });
      active = false;
      const currentSocket = socket;
      socket = undefined;
      if (notify && currentSocket?.readyState === WebSocket.OPEN) currentSocket.send(JSON.stringify({ type:'release' }));
      currentSocket?.close(1000, reason);
      processor?.disconnect(); processor = undefined;
      source?.disconnect(); source = undefined;
      stream?.getTracks().forEach((track) => track.stop()); stream = undefined;
      const currentContext = context; context = undefined;
      await currentContext?.close().catch(() => {});
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', 'Start voice');
      if (reason !== 'upstream-error' && reason !== 'server-error') setStatus('Ready', 'Tap to speak with this Pi session.');
    }

    button.addEventListener('click', () => active ? stop() : start());
    window.addEventListener('error', (event) => report('window.error', { message:event.message, error:errorData(event.error) }));
    window.addEventListener('unhandledrejection', (event) => report('window.unhandled_rejection', errorData(event.reason)));
    window.addEventListener('pagehide', () => { stream?.getTracks().forEach((track) => track.stop()); if (active) navigator.sendBeacon('/api/stop', new Blob([JSON.stringify({ clientId })], {type:'application/json'})); });
    report('page.loaded', { clientId, userAgent:navigator.userAgent, secureContext:window.isSecureContext });
  </script>
</body>
</html>`;
