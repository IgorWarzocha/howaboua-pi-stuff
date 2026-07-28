export const LAN_VOICE_AUDIO_WORKLET = String.raw`
const TARGET_RATE = 24000;
const CAPTURE_FRAME_SAMPLES = 480;
const PLAYBACK_START_SAMPLES = 960;
const PLAYBACK_MAX_SAMPLES = 6000;

class PiLanVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capturePosition = 1;
    this.capturePrevious = 0;
    this.capture = new Int16Array(CAPTURE_FRAME_SAMPLES);
    this.captureLength = 0;
    this.playback = [];
    this.playbackOffset = 0;
    this.playbackPhase = 0;
    this.playing = false;
    this.port.onmessage = (event) => this.enqueuePlayback(event.data);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    if (input?.[0]) this.captureInput(input);
    const output = outputs[0]?.[0];
    if (output) this.renderPlayback(output);
    return true;
  }

  captureInput(channels) {
    const inputLength = channels[0].length;
    const mono = new Float32Array(inputLength + 1);
    mono[0] = this.capturePrevious;
    for (let index = 0; index < inputLength; index++) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] || 0;
      mono[index + 1] = sample / channels.length;
    }
    const step = sampleRate / TARGET_RATE;
    while (this.capturePosition < mono.length - 1) {
      const base = Math.floor(this.capturePosition);
      const fraction = this.capturePosition - base;
      const sample = mono[base] + (mono[base + 1] - mono[base]) * fraction;
      const clamped = Math.max(-1, Math.min(1, sample));
      this.capture[this.captureLength++] = clamped < 0 ? clamped * 32768 : clamped * 32767;
      this.capturePosition += step;
      if (this.captureLength === CAPTURE_FRAME_SAMPLES) {
        const frame = this.capture.buffer;
        this.port.postMessage(frame, [frame]);
        this.capture = new Int16Array(CAPTURE_FRAME_SAMPLES);
        this.captureLength = 0;
      }
    }
    this.capturePosition -= inputLength;
    this.capturePrevious = mono[mono.length - 1];
  }

  enqueuePlayback(value) {
    if (!(value instanceof ArrayBuffer) || value.byteLength % 2 !== 0) return;
    const samples = new Int16Array(value);
    for (const sample of samples) this.playback.push(sample / (sample < 0 ? 32768 : 32767));
    const available = this.playback.length - this.playbackOffset;
    if (available > PLAYBACK_MAX_SAMPLES) this.playbackOffset += available - PLAYBACK_MAX_SAMPLES;
    if (!this.playing && this.playback.length - this.playbackOffset >= PLAYBACK_START_SAMPLES) this.playing = true;
    this.compactPlayback();
  }

  renderPlayback(output) {
    const step = TARGET_RATE / sampleRate;
    for (let index = 0; index < output.length; index++) {
      const available = this.playback.length - this.playbackOffset;
      if (!this.playing || available < 2) {
        output[index] = 0;
        this.playing = false;
        continue;
      }
      const base = Math.floor(this.playbackPhase);
      if (base + 1 >= available) {
        output[index] = 0;
        continue;
      }
      const fraction = this.playbackPhase - base;
      const left = this.playback[this.playbackOffset + base];
      const right = this.playback[this.playbackOffset + base + 1];
      output[index] = left + (right - left) * fraction;
      this.playbackPhase += step;
      const consumed = Math.floor(this.playbackPhase);
      if (consumed > 0) {
        this.playbackOffset += consumed;
        this.playbackPhase -= consumed;
      }
    }
    this.compactPlayback();
  }

  compactPlayback() {
    if (this.playbackOffset < 2048) return;
    this.playback = this.playback.slice(this.playbackOffset);
    this.playbackOffset = 0;
  }
}

registerProcessor('pi-lan-voice', PiLanVoiceProcessor);
`;
