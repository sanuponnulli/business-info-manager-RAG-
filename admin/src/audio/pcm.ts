/**
 * Audio format helpers for the voice tester. The browser works with
 * Float32 samples between -1 and 1 at the sound card's rate (usually
 * 48 kHz); Gemini Live wants 16-bit integer PCM at 16 kHz going in and
 * sends 16-bit PCM at 24 kHz coming back. These functions convert between
 * the two worlds. They are plain functions, so they're unit-tested.
 */

/**
 * Converts a stream of samples from one rate to another, chunk by chunk.
 *
 * It walks through the input in steps of inRate/outRate (3 for 48k→16k)
 * and, where a step lands between two samples, blends them in proportion
 * (linear interpolation). Leftover samples are kept for the next chunk, so
 * chunk boundaries don't cause clicks.
 *
 * (A studio-grade resampler would also filter out frequencies above 8 kHz
 * first; for speech recognition this simple version is good enough.)
 */
export class Resampler {
  private readonly step: number;
  private tail = new Float32Array(0);
  private pos = 0;

  constructor(inRate: number, outRate: number) {
    this.step = inRate / outRate;
  }

  process(input: Float32Array): Float32Array {
    const buf = new Float32Array(this.tail.length + input.length);
    buf.set(this.tail);
    buf.set(input, this.tail.length);

    const out: number[] = [];
    let pos = this.pos;
    while (pos + 1 < buf.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      out.push(buf[i] * (1 - frac) + buf[i + 1] * frac);
      pos += this.step;
    }

    // Keep what we haven't used yet. If the last step jumped past the end of
    // this chunk, carry the overshoot into the next chunk's position.
    const keepFrom = Math.min(Math.floor(pos), buf.length);
    this.tail = buf.slice(keepFrom);
    this.pos = pos - keepFrom;
    return Float32Array.from(out);
  }
}

/** -1..1 floats → 16-bit integers (-32768..32767), clipping anything louder. */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** 16-bit integers → -1..1 floats, for playback through Web Audio. */
export function int16ToFloat(samples: Int16Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 0x8000;
  return out;
}

/** Raw bytes → base64 text (what goes inside our JSON messages). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // build the string in pieces to avoid huge argument lists
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 text → raw bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Int16 samples ↔ base64, as little-endian bytes (how every platform we target stores them). */
export const int16ToBase64 = (samples: Int16Array) =>
  bytesToBase64(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));

export function base64ToInt16(base64: string): Int16Array {
  const bytes = base64ToBytes(base64);
  // Copy into a fresh, even-length buffer: Int16Array needs 2-byte alignment.
  const aligned = new Uint8Array(bytes.length - (bytes.length % 2));
  aligned.set(bytes.subarray(0, aligned.length));
  return new Int16Array(aligned.buffer);
}

/** Loudness of a chunk, 0..1 (root mean square), for the mic level meter. */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}
