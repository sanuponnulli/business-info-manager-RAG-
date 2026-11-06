import { describe, it, expect } from "vitest";
import { Resampler, floatToInt16, int16ToFloat, int16ToBase64, base64ToInt16, rms } from "./pcm";

/** One second of a 440 Hz tone at the given sample rate. */
const tone = (rate: number, seconds = 1) =>
  Float32Array.from({ length: rate * seconds }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate));

describe("Resampler", () => {
  it("turns 1 s at 48 kHz into ~1 s at 16 kHz", () => {
    const out = new Resampler(48000, 16000).process(tone(48000));
    expect(out.length).toBeGreaterThanOrEqual(15999);
    expect(out.length).toBeLessThanOrEqual(16000);
  });

  it("handles 44.1 kHz (a non-whole ratio)", () => {
    const out = new Resampler(44100, 16000).process(tone(44100));
    expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(1);
  });

  it("gives the same result whether fed in one go or in 128-sample chunks", () => {
    const input = tone(48000, 0.5);
    const whole = new Resampler(48000, 16000).process(input);

    const r = new Resampler(48000, 16000);
    const parts: number[] = [];
    for (let i = 0; i < input.length; i += 128) parts.push(...r.process(input.subarray(i, i + 128)));

    expect(parts.length).toBe(whole.length);
    parts.forEach((v, i) => expect(v).toBeCloseTo(whole[i], 6));
  });

  it("keeps the tone's loudness", () => {
    const out = new Resampler(48000, 16000).process(tone(48000));
    expect(rms(out)).toBeCloseTo(rms(tone(48000)), 2);
  });
});

describe("format conversion", () => {
  it("float → int16 maps -1..1 onto the full range and clips beyond it", () => {
    expect([...floatToInt16(Float32Array.from([0, 1, -1, 2, -2]))]).toEqual([0, 32767, -32768, 32767, -32768]);
  });

  it("int16 → float lands back in -1..1", () => {
    const back = int16ToFloat(Int16Array.from([0, 16384, -32768]));
    expect([...back]).toEqual([0, 0.5, -1]);
  });

  it("round-trips int16 samples through base64", () => {
    const samples = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
    expect([...base64ToInt16(int16ToBase64(samples))]).toEqual([...samples]);
  });

  it("encodes little-endian, as the server expects", () => {
    // 1 = bytes 01 00 → base64 "AQA="
    expect(int16ToBase64(Int16Array.from([1]))).toBe("AQA=");
  });
});
