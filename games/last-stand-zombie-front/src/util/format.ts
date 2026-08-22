const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'] as const;

/**
 * Kompakte Zahlendarstellung fuer das HUD: 1.2K, 34.5M, 6.7B.
 * Combat Power waechst ueber Tiers exponentiell (PLAN.md 3.2), rohe Zahlen
 * waeren im HUD unlesbar.
 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  const sign = value < 0 ? '-' : '';
  let n = Math.abs(value);
  if (n < 1000) return sign + (Number.isInteger(n) ? String(n) : n.toFixed(1));

  let unitIndex = 0;
  while (n >= 1000 && unitIndex < UNITS.length - 1) {
    n /= 1000;
    unitIndex += 1;
  }
  const digits = n < 10 ? 2 : n < 100 ? 1 : 0;
  return `${sign}${n.toFixed(digits)}${UNITS[unitIndex] ?? ''}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
