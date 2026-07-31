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
    this.playback = new Float32Array(PLAYBACK_MAX_SAMPLES);
    this.playbackRead = 0;
    this.playbackLength = 0;
    this.playing = false;
    this.playbackPhase = 0;
    this.playbackCurrent = 0;
    this.playbackNext = 0;
    this.port.onmessage = (event) => this.queuePlayback(event.data);
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

  queuePlayback(value) {
    if (!(value instanceof ArrayBuffer) || value.byteLength === 0 || value.byteLength % 2 !== 0) return;
    const samples = new Int16Array(value);
    for (const sample of samples) {
      if (this.playbackLength === PLAYBACK_MAX_SAMPLES) {
        this.playbackRead = (this.playbackRead + 1) % PLAYBACK_MAX_SAMPLES;
        this.playbackLength -= 1;
      }
      this.playback[(this.playbackRead + this.playbackLength) % PLAYBACK_MAX_SAMPLES] = sample / (sample < 0 ? 32768 : 32767);
      this.playbackLength += 1;
    }
  }

  renderPlayback(output) {
    output.fill(0);
    if (!this.playing) {
      if (this.playbackLength < PLAYBACK_START_SAMPLES) return;
      this.playing = true;
      this.playbackPhase = 0;
      this.playbackCurrent = this.shiftPlayback();
      this.playbackNext = this.shiftPlayback();
    }
    const step = TARGET_RATE / sampleRate;
    for (let index = 0; index < output.length; index++) {
      output[index] = this.playbackCurrent + (this.playbackNext - this.playbackCurrent) * this.playbackPhase;
      this.playbackPhase += step;
      while (this.playbackPhase >= 1) {
        this.playbackPhase -= 1;
        this.playbackCurrent = this.playbackNext;
        if (this.playbackLength === 0) {
          this.playing = false;
          return;
        }
        this.playbackNext = this.shiftPlayback();
      }
    }
  }

  shiftPlayback() {
    const sample = this.playback[this.playbackRead] || 0;
    this.playbackRead = (this.playbackRead + 1) % PLAYBACK_MAX_SAMPLES;
    this.playbackLength -= 1;
    return sample;
  }
}

registerProcessor('pi-lan-voice', PiLanVoiceProcessor);
`;
