/**
 * Just enough WAV handling for the voice test script.
 * A WAV file is a small header describing the audio, followed by the raw
 * PCM samples. Gemini wants (and returns) the raw samples without a header.
 */

export interface Pcm {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Buffer;
}

/** Finds the "fmt " (format) and "data" sections inside a WAV file. */
export function readWav(file: Buffer): Pcm {
  if (file.toString("ascii", 0, 4) !== "RIFF" || file.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  let format: Omit<Pcm, "samples"> | null = null;
  for (let offset = 12; offset + 8 <= file.length; ) {
    const id = file.toString("ascii", offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = {
        channels: file.readUInt16LE(body + 2),
        sampleRate: file.readUInt32LE(body + 4),
        bitsPerSample: file.readUInt16LE(body + 14),
      };
    }
    if (id === "data") {
      if (!format) throw new Error("WAV data before format");
      return { ...format, samples: file.subarray(body, body + size) };
    }
    offset = body + size + (size % 2); // sections are padded to an even length
  }
  throw new Error("WAV file has no audio data");
}

/** Wraps raw 16-bit mono PCM in a WAV header so any player can open it. */
export function writeWav(samples: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt section size
  header.writeUInt16LE(1, 20); // 1 = uncompressed PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32); // bytes per sample frame
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}
