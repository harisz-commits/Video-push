/**
 * How long an MP3 is, by walking its frames.
 *
 * Needed wherever recordings are joined end to end: every chunk after the
 * first has to be shifted by the real duration of everything before it, and
 * the last timestamp of a chunk is not that duration — it is where the last
 * character was spoken, and the sound after it still takes time. Measured
 * against two ElevenLabs clips whose alignments were known, the file runs 50
 * to 70 milliseconds past the final timestamp. Treating that as zero pulls
 * every later chunk forward, and the error accumulates down the whole video.
 */
export function mp3Duration(buffer: Buffer): number {
  const RATES = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
  ];
  const FREQ: Record<number, number[]> = {
    3: [44100, 48000, 32000], // MPEG-1
    2: [22050, 24000, 16000], // MPEG-2
    0: [11025, 12000, 8000], // MPEG-2.5
  };

  let i = 0;
  let seconds = 0;

  while (i < buffer.length - 4) {
    if (buffer[i] !== 0xff || (buffer[i + 1] & 0xe0) !== 0xe0) {
      i += 1;
      continue;
    }
    const version = (buffer[i + 1] >> 3) & 0x03;
    const bitrateIndex = (buffer[i + 2] >> 4) & 0x0f;
    const sampleIndex = (buffer[i + 2] >> 2) & 0x03;
    const padding = (buffer[i + 2] >> 1) & 0x01;

    const rates = FREQ[version];
    if (!rates || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) {
      i += 1;
      continue;
    }
    const bitrate = RATES[bitrateIndex] * 1000;
    const sampleRate = rates[sampleIndex];
    if (!bitrate || !sampleRate) {
      i += 1;
      continue;
    }

    const samples = version === 3 ? 1152 : 576;
    const length = Math.floor((samples / 8) * (bitrate / sampleRate)) + padding;
    if (length <= 0) {
      i += 1;
      continue;
    }

    seconds += samples / sampleRate;
    i += length;
  }

  return seconds;
}
