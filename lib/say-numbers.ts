/**
 * Numbers, written the way they are spoken.
 *
 * ElevenLabs decides for itself what "2023" sounds like, and in German it
 * decides badly — sometimes "zwanzig dreiundzwanzig", sometimes the digits one
 * by one, and it is not stable between takes. Roman numerals are worse: "VII"
 * is read as letters. Neither is fixable at the voice's end, so nothing
 * numeric is ever sent to it. It receives words.
 *
 * The conversion belongs to the SPOKEN copy of a text only. What is written on
 * screen keeps its digits — "1789" is what a viewer reads in a fraction of a
 * second, "siebzehnhundertneunundachtzig" is not.
 */

const ONES = [
  "null",
  "eins",
  "zwei",
  "drei",
  "vier",
  "fünf",
  "sechs",
  "sieben",
  "acht",
  "neun",
  "zehn",
  "elf",
  "zwölf",
  "dreizehn",
  "vierzehn",
  "fünfzehn",
  "sechzehn",
  "siebzehn",
  "achtzehn",
  "neunzehn",
];

const TENS = [
  "",
  "",
  "zwanzig",
  "dreißig",
  "vierzig",
  "fünfzig",
  "sechzig",
  "siebzig",
  "achtzig",
  "neunzig",
];

/**
 * The scale words that stand as their own words.
 *
 * "tausend" is not among them: German writes eintausendzweihundert as one
 * word, but zwei Millionen as two. Getting this wrong is audible — the voice
 * pauses where the space is.
 */
const SCALES: { value: number; one: string; many: string }[] = [
  { value: 1e12, one: "eine Billion", many: "Billionen" },
  { value: 1e9, one: "eine Milliarde", many: "Milliarden" },
  { value: 1e6, one: "eine Million", many: "Millionen" },
];

/** 1–999, as the piece of a compound word. `standalone` picks eins over ein. */
function small(n: number, standalone: boolean): string {
  if (n < 20) {
    // "einundzwanzig", never "einsundzwanzig" — but 1 on its own is "eins".
    if (n === 1) return standalone ? "eins" : "ein";
    return ONES[n];
  }
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const rest = n % 10;
    if (rest === 0) return TENS[tens];
    return `${small(rest, false)}und${TENS[tens]}`;
  }
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return `${small(hundreds, false)}hundert${rest ? small(rest, true) : ""}`;
}

/** A whole number, as one German word (plus separate scale words). */
export function cardinal(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n < 0) return `minus ${cardinal(-n)}`;
  if (n === 0) return "null";

  for (const scale of SCALES) {
    if (n >= scale.value) {
      const count = Math.floor(n / scale.value);
      const rest = n % scale.value;
      const head =
        count === 1 ? scale.one : `${cardinal(count)} ${scale.many}`;
      return rest ? `${head} ${cardinal(rest)}` : head;
    }
  }

  if (n >= 1000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    return `${small(thousands, false)}tausend${rest ? small(rest, true) : ""}`;
  }
  return small(n, true);
}

/**
 * A year, which German does not say the way it says a quantity.
 *
 * 1983 is neunzehnhundertdreiundachtzig, not eintausendneunhundert­
 * dreiundachtzig — the second is not wrong so much as something no German
 * speaker says about a year. The hundreds form runs from 1100 to 1999; from
 * 2000 on the ordinary form took over, which is why 2023 is
 * zweitausenddreiundzwanzig.
 */
function year(n: number): string {
  if (n < 1100 || n > 1999) return cardinal(n);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return `${small(hundreds, false)}hundert${rest ? small(rest, true) : ""}`;
}

const ORDINAL_IRREGULAR: Record<number, string> = {
  1: "erste",
  3: "dritte",
  7: "siebte",
  8: "achte",
};

/**
 * "der Vierzehnte" — the form a monarch's numeral takes.
 *
 * Nominative only. "unter Ludwig dem Vierzehnten" would need the case, and
 * nothing here knows it; the nominative is what a quiz question asks in
 * ("Wer war Ludwig XIV.?"), so it is the one worth getting right.
 */
function ordinal(n: number): string {
  const base =
    ORDINAL_IRREGULAR[n] ??
    (n < 20 ? `${cardinal(n)}te` : `${cardinal(n)}ste`);
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const ROMAN: [string, number][] = [
  ["M", 1000],
  ["CM", 900],
  ["D", 500],
  ["CD", 400],
  ["C", 100],
  ["XC", 90],
  ["L", 50],
  ["XL", 40],
  ["X", 10],
  ["IX", 9],
  ["V", 5],
  ["IV", 4],
  ["I", 1],
];

/** The value of a Roman numeral, or null if it is not canonically written. */
function roman(text: string): number | null {
  const values: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const here = values[text[i]];
    const next = values[text[i + 1]];
    if (!here) return null;
    total += next && next > here ? -here : here;
  }
  // Written back out, a real numeral reproduces itself. This is what rejects
  // XXL, IIII and MMMM — strings that parse to a number but are not numerals,
  // and would otherwise turn a clothing size into "vierzig".
  let out = "";
  let rest = total;
  for (const [symbol, value] of ROMAN) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out === text ? total : null;
}

/**
 * Words after which a lone capital letter is not a number.
 *
 * "Vitamin C" is the case that matters: read as a numeral it becomes
 * "Vitamin einhundert". Single letters are only ever read as numerals directly
 * before a full stop — the German ordinal marker, as in "Karl V." — and even
 * then only I, V and X, which are the letters monarchs actually carry. C, D, L
 * and M standing alone are a vitamin, a note, a litre or a motorway far more
 * often than they are five hundred.
 */
const NOT_A_NUMERAL = new Set([
  "vitamin",
  "grad",
  "größe",
  "groesse",
  "typ",
  "klasse",
  "modell",
  "plan",
  "punkt",
  "note",
  "version",
  "gruppe",
  "liter",
  "volt",
  "variante",
  // A quiz says these constantly, and every one of them is followed by a
  // letter that is not a number.
  "antwort",
  "option",
  "buchstabe",
  "faktor",
  "generation",
]);

const MONTHS =
  /^(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/;

/**
 * Rewrite every number in a text as the words for it.
 *
 * Meant for the copy that goes to the voice. Applying it to anything that is
 * also displayed would be a mistake — see the note at the top of the file.
 */
export function spellNumbers(text: string): string {
  let out = text;

  // Thousands separators first, so 1.000.000 is one number rather than three.
  // Only between full groups of three, which is what keeps a sentence ending
  // in a digit from swallowing the next one.
  out = out.replace(/\b(\d{1,3})(\.\d{3})+\b/g, (match) =>
    match.replace(/\./g, ""),
  );

  // Decimals. German reads the fractional part digit by digit: 3,14 is
  // "drei Komma eins vier", never "drei Komma vierzehn".
  out = out.replace(/\b(\d+),(\d+)\b/g, (_m, whole: string, frac: string) => {
    const digits = [...frac].map((d) => ONES[Number(d)]).join(" ");
    return `${cardinal(Number(whole))} Komma ${digits}`;
  });

  // Dates: the period after the day is an ordinal marker, and before a month
  // German declines it — "am fünften Mai", not "am fünfte Mai".
  out = out.replace(/\b(\d{1,2})\.\s+(?=[A-ZÄÖÜ])/g, (match, day: string, offset: number, whole: string) => {
    const after = whole.slice(offset + match.length);
    if (!MONTHS.test(after)) return match;
    const word = ordinal(Number(day)).toLowerCase();
    return `${word}n `;
  });

  // Roman numerals. Multi-letter ones are unambiguous; a lone letter is only
  // read as one directly before a full stop, and only I, V or X.
  out = out.replace(
    /(^|[\s(„"'])([IVXLCDM]{1,7})(\.?)(?=$|[\s).,;:!?"'—–-])/g,
    (match, lead: string, numeral: string, dot: string, offset: number, whole: string) => {
      const value = roman(numeral);
      if (value === null) return match;

      const before = whole
        .slice(0, offset + lead.length)
        .trimEnd()
        .split(/\s+/)
        .pop()
        ?.replace(/[^\p{L}]/gu, "")
        .toLowerCase();
      if (before && NOT_A_NUMERAL.has(before)) return match;

      if (numeral.length === 1) {
        // Only I, V and X, and never C, D, L or M. Those four are a vitamin,
        // a note, a litre or a motorway far more often than they are a number
        // — and in a quiz, "Antwort C" would otherwise be read as
        // "Antwort einhundert", which is the worst sentence this file could
        // produce.
        if (!"IVX".includes(numeral)) return match;
        // A digit before it makes it a unit, not a numeral: "230 V" is volts.
        if (/\d\s*$/.test(whole.slice(0, offset + lead.length))) return match;
        return dot ? `${lead}der ${ordinal(value)}` : `${lead}${cardinal(value)}`;
      }
      // "Heinrich VIII." — the full stop is what makes it an ordinal. Without
      // it the numeral is a plain count and stays one.
      return dot
        ? `${lead}der ${ordinal(value)}`
        : `${lead}${cardinal(value)}`;
    },
  );

  // A minus sign, but only where it is one. Between two numbers a dash is a
  // range ("1914–1918") and the voice reads it as the pause it is.
  out = out.replace(/(^|[\s(])[-−]\s?(?=\d)/g, "$1minus ");

  // Everything left that is a run of digits. Four-digit numbers in the year
  // range take the years' form; see year().
  out = out.replace(/\b(\d+)\b/g, (match, digits: string) => {
    const n = Number(digits);
    if (!Number.isSafeInteger(n)) return match;
    // A leading zero is a code, not a quantity — "007" is not "sieben".
    if (digits.length > 1 && digits.startsWith("0")) {
      return [...digits].map((d) => ONES[Number(d)]).join(" ");
    }
    return digits.length === 4 ? year(n) : cardinal(n);
  });

  return out;
}
