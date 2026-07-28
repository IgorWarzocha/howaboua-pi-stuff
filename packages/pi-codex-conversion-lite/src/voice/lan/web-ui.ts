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
    let peer;
    let channel;
    let stream;
    let active = false;
    let busy = false;

    const setStatus = (title, message) => { state.textContent = title; detail.textContent = message; };
    const post = async (path, body = {}) => {
      const response = await fetch(path, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Pi voice request failed');
      return payload;
    };
    const sendState = (value) => { void post('/api/state', { state:value }).catch(() => {}); };

    const events = new EventSource('/api/events');
    events.onopen = () => { connection.classList.add('online'); connection.lastElementChild.textContent = 'Connected to Pi'; };
    events.onerror = () => { connection.classList.remove('online'); connection.lastElementChild.textContent = 'Reconnecting to Pi'; if (active) void stop(false); };
    events.onmessage = (event) => {
      const command = JSON.parse(event.data);
      if (command.type === 'send_data' && channel?.readyState === 'open') channel.send(JSON.stringify(command.message));
      if (command.type === 'stop') void stop(false);
    };

    const waitForIce = (pc) => pc.iceGatheringState === 'complete' ? Promise.resolve() : new Promise((resolve) => {
      const changed = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', changed); resolve(); } };
      pc.addEventListener('icegatheringstatechange', changed);
      setTimeout(resolve, 5000);
    });

    async function start() {
      if (busy || active) return;
      busy = true; button.disabled = true; setStatus('Opening microphone…', 'Use the browser prompt to allow audio.');
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS. Open the https:// address shown by Pi and accept its local certificate.');
        stream = await navigator.mediaDevices.getUserMedia({ audio:true });
        peer = new RTCPeerConnection();
        stream.getTracks().forEach((track) => peer.addTrack(track, stream));
        channel = peer.createDataChannel('oai-events');
        channel.onopen = () => { sendState('ready'); setStatus('Listening', 'Speak naturally. Tap again to stop.'); };
        channel.onmessage = (event) => { try { void post('/api/data', { message:JSON.parse(event.data) }).catch(() => {}); } catch {} };
        channel.onerror = () => sendState('failed');
        channel.onclose = () => { if (active) void stop(false); };
        peer.ontrack = (event) => { audio.srcObject = event.streams[0]; void audio.play().catch(() => setStatus('Tap once more', 'Your browser paused speaker playback.')); };
        peer.onconnectionstatechange = () => {
          const value = peer?.connectionState;
          if (value) sendState(value);
          if (value === 'failed' || value === 'closed') void stop(false);
        };
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await waitForIce(peer);
        const result = await post('/api/call', { offer:peer.localDescription.sdp });
        await peer.setRemoteDescription({ type:'answer', sdp:result.answer });
        active = true;
        button.setAttribute('aria-pressed', 'true');
        button.setAttribute('aria-label', 'Stop voice');
        setStatus('Connecting…', 'Codex voice is joining the call.');
      } catch (error) {
        await stop(false);
        setStatus('Could not start', error instanceof Error ? error.message : String(error));
      } finally { busy = false; button.disabled = false; }
    }

    async function stop(notify = true) {
      if (notify) void post('/api/stop').catch(() => {});
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
    window.addEventListener('pagehide', () => { if (active) navigator.sendBeacon('/api/stop', new Blob(['{}'], {type:'application/json'})); });
  </script>
</body>
</html>`;
