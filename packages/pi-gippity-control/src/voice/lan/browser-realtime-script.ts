import { LAN_VOICE_MICROPHONE_BUFFER_WORKLET } from "./microphone-buffer-worklet.ts";

const MICROPHONE_WORKLET_SOURCE = JSON.stringify(
	LAN_VOICE_MICROPHONE_BUFFER_WORKLET,
);

export const LAN_VOICE_BROWSER_REALTIME_SCRIPT = String.raw`
async function createRealtimeBrowserPeer({ stream, sendControl, fail }) {
  const context = new AudioContext({ latencyHint:'interactive' });
  let source;
  let worklet;
  let destination;
  let peer;
  let dataChannel;
  let output;
  let disconnectTimer;
  try {
    const workletUrl = URL.createObjectURL(new Blob([${MICROPHONE_WORKLET_SOURCE}], { type:'text/javascript' }));
    try { await context.audioWorklet.addModule(workletUrl); }
    finally { URL.revokeObjectURL(workletUrl); }
    await context.resume();
    if (context.state !== 'running') throw new Error('Browser audio did not start. Check its media permissions.');
    source = context.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(context, 'pi-lan-microphone-buffer', { channelCount:1, channelCountMode:'explicit', outputChannelCount:[1] });
    destination = context.createMediaStreamDestination();
    destination.channelCount = 1;
    source.connect(worklet);
    worklet.connect(destination);

    peer = new RTCPeerConnection();
    output = new Audio();
    output.autoplay = true;
    output.playsInline = true;
    dataChannel = peer.createDataChannel('oai-events');
    dataChannel.onopen = () => sendControl({ type:'peer_state', state:'ready' });
    dataChannel.onclose = () => sendControl({ type:'peer_state', state:'closed' });
    dataChannel.onerror = () => fail(new Error('Realtime data channel failed'));
    dataChannel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try { sendControl({ type:'peer_data', message:JSON.parse(event.data) }); }
      catch { fail(new Error('Realtime data channel sent invalid JSON')); }
    };
    peer.ontrack = (event) => {
      output.srcObject = event.streams[0] || new MediaStream([event.track]);
      void output.play().catch(() => fail(new Error('Browser blocked realtime audio playback')));
    };
    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      if (state === 'connected') worklet.port.postMessage({ type:'release' });
      if (state === 'disconnected' && !disconnectTimer) {
        disconnectTimer = setTimeout(() => {
          disconnectTimer = undefined;
          if (peer.connectionState === 'disconnected') fail(new Error('Realtime connection did not recover'));
        }, 10000);
      } else if (state !== 'disconnected' && disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = undefined;
      }
      if (['connected','disconnected','failed','closed'].includes(state)) sendControl({ type:'peer_state', state });
    };
    const mediaStream = destination.stream;
    for (const track of mediaStream.getAudioTracks()) peer.addTrack(track, mediaStream);
    const offer = await peer.createOffer();
    if (!offer.sdp) throw new Error('Realtime voice offer did not include SDP');
    await peer.setLocalDescription(offer);
    if (peer.iceGatheringState !== 'complete') {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(new Error('Realtime ICE gathering timed out')); }, 10000);
        const changed = () => { if (peer.iceGatheringState === 'complete') { cleanup(); resolve(); } };
        const cleanup = () => { clearTimeout(timeout); peer.removeEventListener('icegatheringstatechange', changed); };
        peer.addEventListener('icegatheringstatechange', changed);
        changed();
      });
    }
    const localSdp = peer.localDescription?.sdp;
    if (!localSdp) throw new Error('Realtime voice local description did not include SDP');
    return {
      offerSdp: localSdp,
      async acceptAnswer(sdp) { await peer.setRemoteDescription({ type:'answer', sdp }); },
      sendData(message) {
        if (dataChannel.readyState !== 'open') throw new Error('Realtime data channel is not open');
        dataChannel.send(JSON.stringify(message));
      },
      close() {
        if (disconnectTimer) clearTimeout(disconnectTimer);
        dataChannel.close();
        peer.close();
        output.pause();
        output.srcObject = null;
        source.disconnect();
        worklet.disconnect();
        destination.stream.getTracks().forEach((track) => track.stop());
        void context.close().catch(() => {});
      },
    };
  } catch (error) {
    if (disconnectTimer) clearTimeout(disconnectTimer);
    dataChannel?.close();
    peer?.close();
    output?.pause();
    source?.disconnect();
    worklet?.disconnect();
    destination?.stream.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => {});
    throw error;
  }
}
`;
