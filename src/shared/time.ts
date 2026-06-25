export const DEFAULT_PPQN = 960;

export function samplesToSeconds(samples: number, sampleRate: number): number {
  if (sampleRate <= 0) {
    throw new RangeError("sampleRate must be positive");
  }
  return samples / sampleRate;
}

export function secondsToSamples(seconds: number, sampleRate: number): number {
  if (sampleRate <= 0) {
    throw new RangeError("sampleRate must be positive");
  }
  return Math.round(seconds * sampleRate);
}

export function samplesToBeats(samples: number, sampleRate: number, tempo: number): number {
  const seconds = samplesToSeconds(samples, sampleRate);
  return (seconds * tempo) / 60;
}

export function beatsToSamples(beats: number, sampleRate: number, tempo: number): number {
  const seconds = (beats * 60) / tempo;
  return secondsToSamples(seconds, sampleRate);
}

export interface BarsBeatsTicks {
  bars: number;
  beats: number;
  ticks: number;
}

export function samplesToBarsBeatsTicks(
  samples: number,
  sampleRate: number,
  tempo: number,
  timeSignature: [number, number],
  ppqn = DEFAULT_PPQN,
): BarsBeatsTicks {
  const totalBeats = samplesToBeats(samples, sampleRate, tempo);
  const [numerator] = timeSignature;
  const totalBars = Math.floor(totalBeats / numerator);
  const remainingBeats = totalBeats - totalBars * numerator;
  const beatIndex = Math.floor(remainingBeats);
  const ticks = Math.round((remainingBeats - beatIndex) * ppqn);
  return { bars: totalBars, beats: beatIndex, ticks };
}

export function barsBeatsTicksToSamples(
  position: BarsBeatsTicks,
  sampleRate: number,
  tempo: number,
  timeSignature: [number, number],
  ppqn = DEFAULT_PPQN,
): number {
  const [numerator] = timeSignature;
  const totalBeats = position.bars * numerator + position.beats + position.ticks / ppqn;
  return beatsToSamples(totalBeats, sampleRate, tempo);
}

export function formatBarsBeatsTicks(position: BarsBeatsTicks): string {
  const bars = String(position.bars + 1).padStart(2, "0");
  const beats = String(position.beats + 1).padStart(2, "0");
  const ticks = String(position.ticks).padStart(3, "0");
  return `${bars}:${beats}:${ticks}`;
}
