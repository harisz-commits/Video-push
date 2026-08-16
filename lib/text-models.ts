/**
 * The models that can write a quiz, and what they cost.
 *
 * Its own module for the same reason the image catalogue is: the studio draws
 * this list in the browser, the route bills against it on the server, and the
 * browser has no business importing either provider's client.
 *
 * Prices are the providers' published list prices per million tokens, in US
 * dollars. They stay in dollars — both bill in dollars, and a euro figure
 * printed here would go wrong the moment the rate moved, quietly.
 */

export type TextModel = {
  id: string;
  /**
   * Other spellings of the same model.
   *
   * These ids move — several shipped with a "-preview" suffix and lost it, and
   * Google retires older ones for new accounts without warning. A 404 costs
   * nothing, so a rejected id falls through to the next spelling rather than
   * becoming a dead entry in a dropdown.
   */
  alt?: string[];
  provider: "anthropic" | "google";
  label: string;
  /** USD per million input tokens. */
  inputPerM: number;
  /** USD per million output tokens — thinking tokens included, on both sides. */
  outputPerM: number;
  /**
   * Whether the model accepts an effort level.
   *
   * Not a nicety: Claude Haiku 4.5 rejects `output_config.effort` outright
   * with a 400, so sending it made the model unusable rather than merely
   * unconfigurable — picking Haiku failed after two seconds with "This model
   * does not support the effort parameter".
   */
  supportsEffort?: boolean;
  note: string;
};

/**
 * Cheapest first.
 *
 * The spread is the point: the cheapest option here costs about a tenth of the
 * dearest for the same quiz, and for a job that is "write thirty questions as
 * JSON" the cheap end is often enough. Which is why this is a choice rather
 * than a decision somebody else made once.
 *
 * Google's 2.5 Flash models are deliberately absent. They are cheaper still on
 * the price list and this account cannot call them at all — "no longer
 * available to new users", as a 404. A dropdown entry that always fails is
 * worse than no entry.
 *
 * Every id here was checked against what this key can actually list, which is
 * also why the floating aliases — `gemini-flash-latest`, `gemini-flash-lite-
 * latest` — are not used as entries. They resolve to whatever Google points
 * them at this week, and a price printed next to a moving target is a wrong
 * price waiting to happen. Fixed versions only; the aliases stay as fallbacks
 * behind a version that has been retired.
 */
export const TEXT_MODELS: TextModel[] = [
  {
    id: "gemini-3.1-flash-lite",
    alt: ["gemini-3.1-flash-lite-preview", "gemini-flash-lite-latest"],
    provider: "google",
    label: "Gemini 3.1 Flash Lite",
    inputPerM: 0.25,
    outputPerM: 1.5,
    note: "Das billigste, das dieser Zugang bekommt. Für klare Themen genug.",
  },
  {
    id: "gemini-3.5-flash-lite",
    alt: ["gemini-3.5-flash-lite-preview"],
    provider: "google",
    label: "Gemini 3.5 Flash Lite",
    inputPerM: 0.3,
    outputPerM: 2.5,
    note: "Eine Generation neuer als 3.1 Lite, kaum teurer.",
  },
  {
    id: "gemini-3.7-flash",
    alt: ["gemini-3.7-flash-preview", "gemini-3.6-flash", "gemini-flash-latest"],
    provider: "google",
    label: "Gemini 3.7 Flash",
    inputPerM: 0.75,
    outputPerM: 3.75,
    note: "Das neuste Flash. Aktionspreis bis 31.12.2026, danach doppelt so teuer. Gemini 3.6 Flash kostet dasselbe und kann dasselbe.",
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    inputPerM: 1,
    outputPerM: 5,
    supportsEffort: false,
    note: "Das schnelle Claude-Modell.",
  },
  {
    id: "gemini-3.5-flash",
    alt: ["gemini-3.5-flash-preview"],
    provider: "google",
    label: "Gemini 3.5 Flash",
    inputPerM: 1.5,
    outputPerM: 9,
    note: "Googles großes Flash-Modell — teurer als 3.7 Flash, solange dessen Aktionspreis gilt.",
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    supportsEffort: true,
    label: "Claude Sonnet 5",
    inputPerM: 3,
    outputPerM: 15,
    note: "Das bisherige Standardmodell — hier erprobt, alle Fakten geprüft.",
  },
  {
    id: "claude-opus-5",
    provider: "anthropic",
    supportsEffort: true,
    label: "Claude Opus 5",
    inputPerM: 5,
    outputPerM: 25,
    note: "Das beste für knifflige Themen — und das teuerste.",
  },
];

/**
 * Which model an id refers to, or the default when it refers to nothing.
 *
 * A closed list, resolved rather than passed through: the id arrives from a
 * public page, and an id taken on trust is permission to bill this account for
 * whatever the provider sells.
 */
export function resolveTextModel(id?: string): TextModel {
  return (
    TEXT_MODELS.find((m) => m.id === id) ??
    TEXT_MODELS.find((m) => m.id === DEFAULT_ID) ??
    TEXT_MODELS.find((m) => m.id === "claude-sonnet-5") ??
    TEXT_MODELS[0]
  );
}

const DEFAULT_ID =
  typeof process === "undefined" ? undefined : process.env.ANTHROPIC_MODEL;

export const DEFAULT_TEXT_MODEL = resolveTextModel();

/**
 * What a run cost, in US cents.
 *
 * Takes measured token counts rather than an estimate — the studio shows this
 * after a generation, so the number on screen is what actually happened rather
 * than what somebody guessed a quiz would cost.
 */
export function costCents(
  model: TextModel,
  usage: { input: number; output: number },
): number {
  return (
    (usage.input / 1_000_000) * model.inputPerM * 100 +
    (usage.output / 1_000_000) * model.outputPerM * 100
  );
}

/**
 * Roughly what a quiz of this size will cost, before one exists to measure.
 *
 * Derived from measured runs: the system prompt and question list come to
 * about 1,200 input tokens, and the answer — JSON plus the model's thinking,
 * which both providers bill as output — to about 200 output tokens per
 * question. Deliberately the pessimistic end, because a number that turns out
 * too low is worse than one that turns out too high.
 */
export function estimateCents(model: TextModel, questions: number): number {
  return costCents(model, { input: 1200, output: 200 * questions });
}
