/**
 * Runs on the browser's dedicated audio thread. The browser calls
 * process() for every 128 samples the microphone produces; we just copy
 * them over to the page (micRecorder.ts), which does the conversion.
 *
 * Plain JavaScript on purpose: audio worklets are loaded as standalone
 * files by URL, outside the normal TypeScript/React bundle.
 */
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0)); // copy: the browser reuses this buffer
    return true; // keep running
  }
}

registerProcessor("recorder-processor", RecorderProcessor);
