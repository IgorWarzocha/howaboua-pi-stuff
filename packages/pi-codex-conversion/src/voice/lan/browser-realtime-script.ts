import { LAN_VOICE_AUDIO_WORKLET } from "./audio-worklet.ts";
import { LAN_VOICE_MICROPHONE_BUFFER_WORKLET } from "./microphone-buffer-worklet.ts";

const AUDIO_WORKLET_SOURCE = JSON.stringify(LAN_VOICE_AUDIO_WORKLET);
const MICROPHONE_WORKLET_SOURCE = JSON.stringify(LAN_VOICE_MICROPHONE_BUFFER_WORKLET);

export const LAN_VOICE_BROWSER_REALTIME_SCRIPT = String.raw`
async function createRealtimeBrowserAudio(stream) {
  const context = new AudioContext({ latencyHint:'interactive' });
  let source;
  let microphoneBuffer;
  let processor;
  try {
    const microphoneUrl = URL.createObjectURL(new Blob([${MICROPHONE_WORKLET_SOURCE}], { type:'text/javascript' }));
    const audioUrl = URL.createObjectURL(new Blob([${AUDIO_WORKLET_SOURCE}], { type:'text/javascript' }));
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
      context,
      processor,
      releaseInput() { microphoneBuffer.port.postMessage({ type:'release' }); },
      play(pcm) { processor.port.postMessage(pcm, [pcm]); },
      close() {
        processor.disconnect();
        microphoneBuffer.disconnect();
        source.disconnect();
        void context.close().catch(() => {});
      },
    };
  } catch (error) {
    processor?.disconnect();
    microphoneBuffer?.disconnect();
    source?.disconnect();
    await context.close().catch(() => {});
    throw error;
  }
}
`;
