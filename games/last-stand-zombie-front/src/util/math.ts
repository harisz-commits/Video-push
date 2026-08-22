export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Framerate-unabhaengige Annaeherung. `smoothing` ist der Anteil, der pro
 * 1/60 s noch offen bleibt (0 = sofort dort, 1 = keine Bewegung).
 */
export function damp(current: number, target: number, smoothing: number, dt: number): number {
  if (smoothing <= 0) return target;
  const factor = 1 - Math.pow(smoothing, dt * 60);
  return current + (target - current) * factor;
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}
