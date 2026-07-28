export const LAN_VOICE_WEB_UI = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#171713">
  <title>Pi voice</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#171713; color:#f3f1e8; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100svh; display:grid; place-items:center; padding:24px; background:radial-gradient(circle at 50% 25%, #29291f 0, #171713 48%, #10100e 100%); }
    main { width:min(100%, 420px); display:grid; justify-items:center; gap:28px; text-align:center; }
    header { display:grid; gap:8px; }
    h1 { margin:0; font:600 clamp(28px,8vw,44px)/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:-.06em; }
    .eyebrow { margin:0; color:#a6a58f; font-size:13px; letter-spacing:.13em; text-transform:uppercase; }
    #voice { width:176px; height:176px; border:1px solid #545441; border-radius:50%; display:grid; place-items:center; cursor:pointer; color:#171713; background:#d8ff72; box-shadow:0 18px 50px #0007, inset 0 1px #fff8; transition:transform 160ms ease, background 160ms ease, box-shadow 160ms ease; }
    #voice:hover { transform:translateY(-2px); box-shadow:0 22px 60px #0008, inset 0 1px #fff8; }
    #voice:active { transform:scale(.98); }
    #voice[aria-pressed="true"] { color:#f3f1e8; background:#d35d43; border-color:#ef896f; box-shadow:0 0 0 10px #d35d4320, 0 18px 50px #0008; }
    #voice:disabled { cursor:wait; opacity:.65; transform:none; }
    #voice svg { width:54px; height:54px; fill:currentColor; }
    .status { min-height:62px; display:grid; gap:8px; align-content:start; }
    #state { margin:0; font-weight:650; font-size:18px; }
    #detail { margin:0; color:#a6a58f; font-size:14px; line-height:1.5; }
    .connection { display:flex; align-items:center; gap:8px; color:#828274; font-size:12px; }
    .dot { width:7px; height:7px; border-radius:50%; background:#6a6a60; }
    .connection.online .dot { background:#d8ff72; box-shadow:0 0 12px #d8ff72aa; }
    .connection.online { color:#b8b7a5; }
    @media (prefers-reduced-motion: reduce) { #voice { transition:none; } }
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
    <audio id="audio" autoplay></audio>
  </main>
  <script>
    const button = document.querySelector('#voice');
    const state = document.querySelector('#state');
    const detail = document.querySelector('#detail');
    const connection = document.querySelector('#connection');
    const audio = document.querySelector('#audio');
    const clientId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
    let peer;
    let channel;
    let stream;
    let statsTimer;
    let active = false;
    let busy = false;

    const setStatus = (title, message) => { state.textContent = title; detail.textContent = message; };
    const errorData = (error) => error instanceof Error
      ? { name:error.name, message:error.message, stack:error.stack, cause:error.cause }
      : { value:String(error) };
    const report = (event, data) => {
      const body = JSON.stringify({ clientId, event, data });
      void fetch('/api/debug', { method:'POST', headers:{'content-type':'application/json'}, body, keepalive:true }).catch(() => {});
    };
    const post = async (path, body = {}) => {
      const requestBody = { clientId, ...body };
      report('fetch.request', { path, body:requestBody });
      try {
        const response = await fetch(path, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(requestBody) });
        const text = await response.text();
        let payload = {};
        try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw:text }; }
        report('fetch.response', { path, status:response.status, headers:Object.fromEntries(response.headers), payload });
        if (!response.ok) throw new Error(payload.error || 'Pi voice request failed');
        return payload;
      } catch (error) {
        report('fetch.error', { path, error:errorData(error) });
        throw error;
      }
    };
    const sendState = (value) => { void post('/api/state', { state:value }).catch((error) => report('state.send_error', errorData(error))); };
    const collectStats = async (label) => {
      const current = peer;
      if (!current) return;
      try {
        const reports = [];
        (await current.getStats()).forEach((entry) => reports.push(typeof entry.toJSON === 'function' ? entry.toJSON() : Object.assign({}, entry)));
        report('webrtc.stats', { label, reports });
      } catch (error) { report('webrtc.stats_error', { label, error:errorData(error) }); }
    };

    report('page.loaded', {
      clientId,
      href:location.href,
      secureContext:window.isSecureContext,
      userAgent:navigator.userAgent,
      platform:navigator.platform,
      language:navigator.language,
      online:navigator.onLine,
      visibility:document.visibilityState,
      mediaDevices:Boolean(navigator.mediaDevices),
      getUserMedia:Boolean(navigator.mediaDevices?.getUserMedia),
    });
    window.addEventListener('error', (event) => report('window.error', { message:event.message, filename:event.filename, lineno:event.lineno, colno:event.colno, error:errorData(event.error) }));
    window.addEventListener('unhandledrejection', (event) => report('window.unhandled_rejection', errorData(event.reason)));
    window.addEventListener('online', () => report('network.online'));
    window.addEventListener('offline', () => report('network.offline'));
    document.addEventListener('visibilitychange', () => report('page.visibility', { state:document.visibilityState }));

    const events = new EventSource('/api/events?client=' + encodeURIComponent(clientId));
    events.onopen = () => { report('sse.open', { readyState:events.readyState }); connection.classList.add('online'); connection.lastElementChild.textContent = 'Connected to Pi'; };
    events.onerror = (event) => { report('sse.error', { readyState:events.readyState, eventType:event.type }); connection.classList.remove('online'); connection.lastElementChild.textContent = 'Reconnecting to Pi'; if (active) void stop(false, 'sse-error'); };
    events.onmessage = (event) => {
      report('sse.message', { data:event.data, lastEventId:event.lastEventId });
      try {
        const command = JSON.parse(event.data);
        if (command.type === 'send_data' && channel?.readyState === 'open') {
          report('data_channel.send', command.message);
          channel.send(JSON.stringify(command.message));
        } else if (command.type === 'send_data') {
          report('data_channel.send_dropped', { readyState:channel?.readyState, message:command.message });
        }
        if (command.type === 'stop') void stop(false, 'server-stop');
      } catch (error) { report('sse.message_error', { error:errorData(error), data:event.data }); }
    };

    const waitForIce = (pc) => pc.iceGatheringState === 'complete' ? Promise.resolve() : new Promise((resolve) => {
      let settled = false;
      const finish = (reason) => { if (settled) return; settled = true; pc.removeEventListener('icegatheringstatechange', changed); report('ice.gathering_finished', { reason, state:pc.iceGatheringState, localDescription:pc.localDescription }); resolve(); };
      const changed = () => { report('ice.gathering_state', { state:pc.iceGatheringState }); if (pc.iceGatheringState === 'complete') finish('complete'); };
      pc.addEventListener('icegatheringstatechange', changed);
      setTimeout(() => finish('timeout'), 5000);
    });

    async function start() {
      if (busy || active) return;
      report('call.start_requested');
      busy = true; button.disabled = true; setStatus('Opening microphone…', 'Use the browser prompt to allow audio.');
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS. Open the https:// address shown by Pi and accept its local certificate.');
        if (navigator.permissions?.query) {
          try { report('microphone.permission', { state:(await navigator.permissions.query({ name:'microphone' })).state }); }
          catch (error) { report('microphone.permission_error', errorData(error)); }
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio:true });
        report('microphone.opened', { tracks:stream.getAudioTracks().map((track) => ({
          id:track.id,
          label:track.label,
          enabled:track.enabled,
          muted:track.muted,
          readyState:track.readyState,
          settings:track.getSettings?.(),
          constraints:track.getConstraints?.(),
          capabilities:track.getCapabilities?.(),
        })) });
        stream.getAudioTracks().forEach((track) => {
          track.addEventListener('mute', () => report('microphone.track_mute', { id:track.id, readyState:track.readyState }));
          track.addEventListener('unmute', () => report('microphone.track_unmute', { id:track.id, readyState:track.readyState }));
          track.addEventListener('ended', () => report('microphone.track_ended', { id:track.id, readyState:track.readyState }));
        });
        peer = new RTCPeerConnection();
        report('webrtc.created', { configuration:peer.getConfiguration() });
        stream.getTracks().forEach((track) => peer.addTrack(track, stream));
        channel = peer.createDataChannel('oai-events');
        report('data_channel.created', { label:channel.label, id:channel.id, ordered:channel.ordered, protocol:channel.protocol, readyState:channel.readyState });
        channel.onopen = () => { report('data_channel.open', { id:channel.id, readyState:channel.readyState }); sendState('ready'); setStatus('Listening', 'Speak naturally. Tap again to stop.'); };
        channel.onmessage = (event) => {
          report('data_channel.message', { data:event.data });
          try { void post('/api/data', { message:JSON.parse(event.data) }).catch((error) => report('data.forward_error', errorData(error))); }
          catch (error) { report('data_channel.message_parse_error', { error:errorData(error), data:event.data }); }
        };
        channel.onerror = (event) => { report('data_channel.error', { readyState:channel?.readyState, eventType:event.type, error:event.error ? errorData(event.error) : undefined }); sendState('failed'); };
        channel.onclosing = () => report('data_channel.closing', { readyState:channel?.readyState });
        channel.onclose = () => { report('data_channel.close', { active, readyState:channel?.readyState }); if (active) void stop(false, 'data-channel-close'); };
        peer.ontrack = (event) => {
          report('webrtc.track', { track:{ id:event.track.id, kind:event.track.kind, label:event.track.label, muted:event.track.muted, readyState:event.track.readyState, settings:event.track.getSettings?.() }, streamIds:event.streams.map((item) => item.id), transceiver:{ direction:event.transceiver.direction, currentDirection:event.transceiver.currentDirection, mid:event.transceiver.mid } });
          audio.srcObject = event.streams[0];
          void audio.play().then(() => report('audio.playing')).catch((error) => { report('audio.play_error', errorData(error)); setStatus('Tap once more', 'Your browser paused speaker playback.'); });
        };
        peer.onicecandidate = (event) => report('ice.candidate', { candidate:event.candidate?.toJSON?.() ?? event.candidate });
        peer.onicecandidateerror = (event) => report('ice.candidate_error', { address:event.address, errorCode:event.errorCode, errorText:event.errorText, port:event.port, url:event.url });
        peer.oniceconnectionstatechange = () => { report('ice.connection_state', { state:peer?.iceConnectionState }); void collectStats('ice-' + peer?.iceConnectionState); };
        peer.onsignalingstatechange = () => report('webrtc.signaling_state', { state:peer?.signalingState });
        peer.onnegotiationneeded = () => report('webrtc.negotiation_needed');
        peer.onconnectionstatechange = () => {
          const value = peer?.connectionState;
          report('webrtc.connection_state', { state:value });
          void collectStats('connection-' + value);
          if (value) sendState(value);
          if (value === 'failed' || value === 'closed') void stop(false, 'peer-' + value);
        };
        const offer = await peer.createOffer();
        report('webrtc.offer_created', offer);
        await peer.setLocalDescription(offer);
        report('webrtc.local_description_set', peer.localDescription);
        await waitForIce(peer);
        const result = await post('/api/call', { offer:peer.localDescription.sdp });
        report('webrtc.answer_received', { answer:result.answer });
        await peer.setRemoteDescription({ type:'answer', sdp:result.answer });
        report('webrtc.remote_description_set', peer.remoteDescription);
        active = true;
        statsTimer = setInterval(() => { void collectStats('interval'); }, 2000);
        button.setAttribute('aria-pressed', 'true');
        button.setAttribute('aria-label', 'Stop voice');
        setStatus('Connecting…', 'Codex voice is joining the call.');
      } catch (error) {
        report('call.start_error', errorData(error));
        await stop(false, 'start-error');
        setStatus('Could not start', error instanceof Error ? error.message : String(error));
      } finally { busy = false; button.disabled = false; }
    }

    async function stop(notify = true, reason = 'user') {
      report('call.stop', { notify, reason, active, busy, peerState:peer?.connectionState, iceState:peer?.iceConnectionState, signalingState:peer?.signalingState, channelState:channel?.readyState });
      if (statsTimer) clearInterval(statsTimer); statsTimer = undefined;
      await collectStats('stop-' + reason);
      if (notify) void post('/api/stop').catch((error) => report('stop.send_error', errorData(error)));
      active = false;
      channel?.close(); channel = undefined;
      peer?.close(); peer = undefined;
      stream?.getTracks().forEach((track) => track.stop()); stream = undefined;
      audio.srcObject = null;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', 'Start voice');
      setStatus('Ready', 'Tap to speak with this Pi session.');
    }

    button.addEventListener('click', () => active ? stop() : start());
    window.addEventListener('pagehide', (event) => {
      report('page.hide', { persisted:event.persisted, active });
      if (active) navigator.sendBeacon('/api/stop', new Blob([JSON.stringify({ clientId })], {type:'application/json'}));
    });
  </script>
</body>
</html>`;
