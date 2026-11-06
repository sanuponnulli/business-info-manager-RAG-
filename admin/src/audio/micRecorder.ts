import workletUrl from "./recorder-worklet.js?url";
import { Resampler, floatToInt16, int16ToBase64, rms } from "./pcm";

const TARGET_RATE = 16000; // what Gemini Live expects
const CHUNK_SAMPLES = 1600; // 100 ms at 16 kHz → 3200 bytes per message

/**
 * Microphone → 16 kHz 16-bit PCM, delivered as base64 slices of 100 ms.
 *
 *   mic ─► AudioContext ─► recorder-worklet (raw 128-sample frames)
 *       ─► Resampler (e.g. 48 kHz → 16 kHz) ─► buffer until 100 ms ─► onChunk(base64)
 */
export class MicRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private resampler: Resampler | null = null;
  private pending: number[] = [];

  constructor(
    private readonly onChunk: (base64: string) => void,
    /** 0..1 loudness, for a level meter. */
    private readonly onLevel?: (level: number) => void,
  ) {}

  async start(): Promise<void> {
    // Asks for permission the first time. Echo cancellation stops the mic
    // picking up the agent's voice from the speakers.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule(workletUrl);

    this.resampler = new Resampler(this.ctx.sampleRate, TARGET_RATE);
    const source = this.ctx.createMediaStreamSource(this.stream);
    const recorder = new AudioWorkletNode(this.ctx, "recorder-processor");
    recorder.port.onmessage = (e: MessageEvent<Float32Array>) => this.handleFrame(e.data);
    source.connect(recorder);
    // The worklet produces no sound; nothing is connected to the speakers.
  }

  private handleFrame(frame: Float32Array): void {
    this.onLevel?.(rms(frame));
    const resampled = this.resampler!.process(frame);
    for (const s of resampled) this.pending.push(s);
    while (this.pending.length >= CHUNK_SAMPLES) {
      const chunk = Float32Array.from(this.pending.splice(0, CHUNK_SAMPLES));
      this.onChunk(int16ToBase64(floatToInt16(chunk)));
    }
  }

  /** Stops the mic, sending whatever audio is still buffered first. */
  async stop(): Promise<void> {
    if (this.pending.length > 0) {
      this.onChunk(int16ToBase64(floatToInt16(Float32Array.from(this.pending))));
      this.pending = [];
    }
    this.stream?.getTracks().forEach((t) => t.stop()); // turns off the browser's "recording" indicator
    await this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.onLevel?.(0);
  }
}
