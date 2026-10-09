export const GROK_AUDIO_WORKLET = String.raw`
const TARGET_RATE = 24000;
const CAPTURE_FRAME_SAMPLES = 480;

class GrokAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capturePosition = 1;
    this.capturePrevious = 0;
    this.capture = new Int16Array(CAPTURE_FRAME_SAMPLES);
    this.captureLength = 0;
    this.captureEpoch = 0;
    this.inputMuted = false;
    this.levelSamples = 0;
    this.levelPeak = 0;
    this.quiet = false;
    this.playback = [];
    this.playbackChunk = 0;
    this.playbackRead = 0;
    this.playbackLength = 0;
    this.playing = false;
    this.playbackPhase = 0;
    this.playbackCurrent = 0;
    this.playbackNext = 0;
    this.playbackHasNext = false;
    this.speakerSuppressed = false;
    this.drains = [];
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    if (!this.inputMuted && input?.[0]) this.captureInput(input);
    const output = outputs[0]?.[0];
    // Report on the next quantum after the final samples were rendered.
    if (!this.playing && this.playbackLength === 0 && this.drains.length) {
      for (const id of this.drains) this.port.postMessage({type:'drained',id,time:currentTime});
      this.drains = [];
    }
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
      // GipPity lan/browser-session.ts MicrophoneLevelMonitor: one second
      // at 24 kHz, detectable peak 82 and healthy peak 655 (PCM16).
      const peak = Math.abs(clamped * 32768);
      if (peak >= 655) {
        this.levelSamples = 0; this.levelPeak = 0; this.setQuiet(false);
      } else {
        this.levelSamples++; this.levelPeak = Math.max(this.levelPeak,peak);
        if (this.levelSamples >= TARGET_RATE) {
          if (this.levelPeak >= 82) this.setQuiet(true);
          this.levelSamples = 0; this.levelPeak = 0;
        }
      }
      this.capturePosition += step;
      if (this.captureLength === CAPTURE_FRAME_SAMPLES) {
        const frame = new ArrayBuffer(CAPTURE_FRAME_SAMPLES * 2);
        const view = new DataView(frame);
        for (let index = 0; index < CAPTURE_FRAME_SAMPLES; index++) view.setInt16(index * 2, this.capture[index], true);
        this.port.postMessage({ type:'capture', epoch:this.captureEpoch, pcm:frame }, [frame]);
        this.capture = new Int16Array(CAPTURE_FRAME_SAMPLES);
        this.captureLength = 0;
      }
    }
    this.capturePosition -= inputLength;
    this.capturePrevious = mono[mono.length - 1];
  }

  handleMessage(value) {
    if (value?.type === 'input_muted' && typeof value.muted === 'boolean' && Number.isSafeInteger(value.epoch)) {
      this.captureEpoch = value.epoch;
      this.inputMuted = value.muted;
      this.resetCapture();
      return;
    }
    if (value?.type === 'speaker_suppressed' && typeof value.suppressed === 'boolean') {
      if (this.speakerSuppressed !== value.suppressed) {
        this.speakerSuppressed = value.suppressed;
        this.resetPlayback();
      }
      return;
    }
    if (value?.type === 'clear') { this.resetPlayback(); return; }
    if (value?.type === 'drain' && Number.isSafeInteger(value.id)) { this.drains.push(value.id); return; }
    this.queuePlayback(value);
  }

  resetCapture() {
    this.levelSamples = 0; this.levelPeak = 0; this.setQuiet(false);
    this.capturePosition = 1;
    this.capturePrevious = 0;
    this.capture = new Int16Array(CAPTURE_FRAME_SAMPLES);
    this.captureLength = 0;
  }

  setQuiet(quiet) {
    if (this.quiet === quiet) return;
    this.quiet = quiet;
    this.port.postMessage({type:'microphone',quiet});
  }

  queuePlayback(value) {
    if (this.speakerSuppressed) return;
    if (!(value instanceof ArrayBuffer) || value.byteLength % 2 !== 0) {
      this.port.postMessage({type:'playback_error',message:'Invalid playback PCM'});
      return;
    }
    if (value.byteLength === 0) return;
    try {
      const samples = new DataView(value);
      const chunk = new Float32Array(samples.byteLength / 2);
      for (let index = 0; index < chunk.length; index++) {
        const sample = samples.getInt16(index * 2, true);
        chunk[index] = sample / (sample < 0 ? 32768 : 32767);
      }
      this.playback.push(chunk);
      this.playbackLength += chunk.length;
    } catch (error) {
      this.port.postMessage({type:'playback_error',message:String(error)});
    }
  }

  resetPlayback() {
    this.playback = [];
    this.playbackChunk = 0;
    this.playbackRead = 0;
    this.playbackLength = 0;
    this.playing = false;
    this.playbackPhase = 0;
    this.playbackCurrent = 0;
    this.playbackNext = 0;
    this.playbackHasNext = false;
    for (const id of this.drains) this.port.postMessage({type:'drained',id,time:currentTime});
    this.drains = [];
  }

  renderPlayback(output) {
    output.fill(0);
    const step = TARGET_RATE / sampleRate;
    for (let index = 0; index < output.length; index++) {
      if (!this.playing) {
        if (!this.playbackLength) return;
        this.playing = true;
        this.playbackPhase = 0;
        this.playbackCurrent = this.shiftPlayback();
        this.playbackHasNext = this.playbackLength > 0;
        this.playbackNext = this.playbackHasNext ? this.shiftPlayback() : this.playbackCurrent;
      }
      // New chunks can arrive during the final sample's output interval.
      if (!this.playbackHasNext && this.playbackLength) {
        this.playbackNext = this.shiftPlayback();
        this.playbackHasNext = true;
      }
      output[index] = this.playbackCurrent + (this.playbackNext - this.playbackCurrent) * this.playbackPhase;
      this.playbackPhase += step;
      while (this.playbackPhase >= 1 && this.playing) {
        this.playbackPhase -= 1;
        if (!this.playbackHasNext) { this.playing = false; break; }
        this.playbackCurrent = this.playbackNext;
        this.playbackHasNext = this.playbackLength > 0;
        this.playbackNext = this.playbackHasNext ? this.shiftPlayback() : this.playbackCurrent;
      }
    }
  }

  shiftPlayback() {
    const chunk = this.playback[this.playbackChunk];
    const sample = chunk[this.playbackRead++];
    this.playbackLength -= 1;
    if (this.playbackRead === chunk.length) {
      this.playback[this.playbackChunk++] = null;
      this.playbackRead = 0;
      if (this.playbackChunk === this.playback.length) {
        this.playback = [];
        this.playbackChunk = 0;
      } else if (this.playbackChunk * 2 >= this.playback.length) {
        this.playback = this.playback.slice(this.playbackChunk);
        this.playbackChunk = 0;
      }
    }
    return sample;
  }

}

registerProcessor('grok-audio', GrokAudioProcessor);
`;
