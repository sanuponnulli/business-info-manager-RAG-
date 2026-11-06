import { base64ToInt16, int16ToFloat } from "./pcm";

/**
 * Plays the agent's reply: base64 slices of 24 kHz 16-bit PCM, arriving
 * one after another while the agent is still talking.
 *
 * Each slice becomes a tiny AudioBuffer scheduled to start exactly when the
 * previous one ends (nextStartTime), so the slices join up without gaps or
 * overlaps. stop() cancels everything queued, for interruptions.
 */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextStartTime = 0;
  private readonly playing = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly sampleRate = 24000,
    /** Called with true when playback starts and false when it finishes or stops. */
    private readonly onPlayingChange?: (playing: boolean) => void,
  ) {}

  /**
   * Browsers only allow audio to start after a user gesture (a click).
   * Call this from a click handler, before the first reply arrives.
   */
  unlock(): void {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
  }

  enqueue(base64: string): void {
    this.unlock();
    const ctx = this.ctx!;
    const samples = int16ToFloat(base64ToInt16(base64));
    if (samples.length === 0) return;

    const buffer = ctx.createBuffer(1, samples.length, this.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // Start right after the previous slice; if we fell behind, start almost now.
    const startAt = Math.max(ctx.currentTime + 0.03, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    if (this.playing.size === 0) this.onPlayingChange?.(true);
    this.playing.add(source);
    source.onended = () => {
      this.playing.delete(source);
      if (this.playing.size === 0) this.onPlayingChange?.(false);
    };
  }

  /** Silences the reply immediately and drops everything queued. */
  stop(): void {
    const wasPlaying = this.playing.size > 0;
    for (const source of this.playing) {
      source.onended = null;
      source.stop();
    }
    this.playing.clear();
    this.nextStartTime = 0;
    if (wasPlaying) this.onPlayingChange?.(false);
  }

  async close(): Promise<void> {
    this.stop();
    await this.ctx?.close();
    this.ctx = null;
  }
}
