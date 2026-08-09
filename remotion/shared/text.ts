/** Break display text into balanced lines without hyphenating. */
export function splitLines(text: string, maxChars = 18): string[] {
  if (text.includes("\n")) {
    return text.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const deFormat = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format a counting number in German, keeping the target's decimal places so
 * the digit count never changes mid-count (that is what makes it jitter).
 */
export function formatNumber(value: number, target: number): string {
  const decimals = decimalsOf(target);
  if (decimals === 0) return deFormat.format(Math.round(value));
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function decimalsOf(n: number): number {
  const s = String(n);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : Math.min(2, s.length - dot - 1);
}
