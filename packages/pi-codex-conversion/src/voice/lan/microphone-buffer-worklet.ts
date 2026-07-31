export const LAN_VOICE_MICROPHONE_BUFFER_WORKLET = String.raw`
class PiLanMicrophoneBuffer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = sampleRate * 3;
    this.samples = new Float32Array(this.capacity);
    this.length = 0;
    this.readOffset = 0;
    this.phase = 'buffering';
    this.threshold = 0.003;
    this.preRoll = sampleRate * 0.1;
    this.port.onmessage = (event) => { if (event.data?.type === 'release') this.release(); };
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);
    if (this.phase === 'buffering') this.append(input);
    else if (this.phase === 'live') this.copy(input, output);
    else {
      if (input?.some((sample) => Math.abs(sample) >= this.threshold)) this.append(input);
      for (let index = 0; index < output.length; index += 1) {
        if (this.length === 0) { this.phase = 'live'; this.copy(input, output, index); break; }
        output[index] = this.shift();
      }
    }
    return true;
  }
  release() {
    if (this.phase !== 'buffering') return;
    let signal;
    for (let index = 0; index < this.length; index += 1) {
      if (Math.abs(this.samples[(this.readOffset + index) % this.capacity]) >= this.threshold) { signal = index; break; }
    }
    if (signal === undefined) { this.length = 0; this.phase = 'live'; return; }
    const discard = Math.max(0, signal - this.preRoll);
    this.readOffset = (this.readOffset + discard) % this.capacity;
    this.length -= discard;
    this.phase = 'replaying';
  }
  append(input) {
    if (!input) return;
    for (const sample of input) {
      if (this.length === this.capacity) { this.readOffset = (this.readOffset + 1) % this.capacity; this.length -= 1; }
      this.samples[(this.readOffset + this.length) % this.capacity] = sample;
      this.length += 1;
    }
  }
  copy(input, output, offset = 0) {
    if (!input) return;
    for (let index = offset; index < output.length && index < input.length; index += 1) output[index] = input[index] || 0;
  }
  shift() {
    const sample = this.samples[this.readOffset] || 0;
    this.readOffset = (this.readOffset + 1) % this.capacity;
    this.length -= 1;
    return sample;
  }
}
registerProcessor('pi-lan-microphone-buffer', PiLanMicrophoneBuffer);
`;
