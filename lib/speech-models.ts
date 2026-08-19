/**
 * The catalogue of speaking models, and what each one costs.
 *
 * Its own module for the same reason lib/image-models.ts is: the studio draws
 * this list in the browser and the route bills against it on the server.
 * Importing lib/elevenlabs.ts into a client component would ship the whole
 * client — and a `process.env` lookup — into the browser bundle for four
 * labels.
 *
 * `credits` is what ElevenLabs charges per character, as a multiple of the
 * plan's own rate. Flash bills at half. That is not a discount to hunt for
 * later: narration is half of what a video costs, so this one field is the
 * largest single lever in the whole format.
 */
export type SpeechModel = {
  id: string;
  label: string;
  /** Credits per character. 1 is the full rate, 0.5 is half. */
  credits: number;
  /**
   * Hard per-request character ceiling.
   *
   * Enforced before the request rather than after: over the limit ElevenLabs
   * refuses in milliseconds, and a refusal after the narration has been
   * assembled looks exactly like a hang. The chunker splits against this.
   */
  maxChars: number;
  /** How many languages the model speaks. Shown, not enforced. */
  languages: number;
  /**
   * Whether the model accepts `language_code`.
   *
   * The reason the studio has to explain itself: Flash and Turbo can be TOLD
   * which language to read, Multilingual v2 only ever guesses from the text.
   * A language picker that silently does nothing on one of two models is worse
   * than no picker, so the model says here whether it listens.
   */
  language: boolean;
  note: string;
};

export const SPEECH_MODELS: SpeechModel[] = [
  {
    id: "eleven_flash_v2_5",
    label: "Flash v2.5",
    credits: 0.5,
    maxChars: 40_000,
    languages: 32,
    language: true,
    note: "Halber Preis. Ein langes Skript passt in eine einzige Aufnahme.",
  },
  {
    id: "eleven_multilingual_v2",
    label: "Multilingual v2",
    credits: 1,
    maxChars: 9_500,
    languages: 29,
    language: false,
    note: "Voller Preis, dafür die ausdrucksstärkere Stimme. Sprache wird erraten.",
  },
];

export const DEFAULT_SPEECH_MODEL_ID = "eleven_multilingual_v2";

/**
 * Which model an id refers to, or the default when it refers to nothing.
 *
 * A closed list, resolved rather than passed through: the id arrives from a
 * public page, and an id taken on trust is permission to bill this account for
 * whatever ElevenLabs sells at whatever it costs.
 */
export function resolveSpeechModel(id?: string): SpeechModel {
  return (
    SPEECH_MODELS.find((m) => m.id === id) ??
    SPEECH_MODELS.find((m) => m.id === DEFAULT_SPEECH_MODEL_ID) ??
    SPEECH_MODELS[0]
  );
}
