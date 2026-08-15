/**
 * The catalogue of image models, and what each one costs.
 *
 * Its own module because both sides need it and only one of them should have
 * the generator: the studio draws this list in the browser, the route bills
 * against it on the server. Importing lib/gemini.ts into a client component
 * would ship the whole Gemini client — and a `process.env` lookup — into the
 * browser bundle for the sake of four labels.
 */

/**
 * `cents` is Google's list price for one 1K image, in US cents, taken from
 * ai.google.dev/gemini-api/docs/pricing. It is shown in the studio beside the
 * button, because a control that spends money per click and does not say how
 * much is one nobody can use responsibly. None of these has a free tier.
 *
 * `alt` exists because these ids move. Several shipped as "-preview" and lost
 * the suffix later; a 404 costs nothing, so a rejected id falls through to the
 * next spelling rather than turning into a dead button.
 */
export type ImageModel = {
  id: string;
  alt?: string[];
  label: string;
  cents: number;
  note: string;
};

/** Cheapest first, so the dearest is never the one picked by accident. */
export const IMAGE_MODELS: ImageModel[] = [
  {
    id: "gemini-3.1-flash-lite-image",
    alt: ["gemini-3.1-flash-lite-image-preview"],
    label: "Nano Banana 2 Lite",
    cents: 3.4,
    note: "Neuer und etwas günstiger als 2.5.",
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image",
    cents: 3.9,
    note: "Das bisherige Standardmodell, hier erprobt.",
  },
  {
    id: "gemini-3.1-flash-image",
    alt: ["gemini-3.1-flash-image-preview"],
    label: "Nano Banana 2",
    cents: 6.7,
    note: "Merklich besser bei Bildern mit vielen Details.",
  },
  {
    id: "gemini-3-pro-image",
    alt: ["gemini-3-pro-image-preview"],
    label: "Nano Banana Pro",
    cents: 13.4,
    note: "Das beste, das Google verkauft — und das teuerste.",
  },
];

/**
 * Which model an id refers to, or the default when it refers to nothing.
 *
 * A closed list, resolved rather than passed through: the id arrives from a
 * public page, and an id taken on trust is permission to bill this account for
 * whatever Google sells at whatever it costs.
 *
 * Falling back rather than failing is deliberate too — a retired id saved in an
 * old project should cost a different picture, not an error.
 */
export function resolveModel(id?: string): ImageModel {
  return (
    IMAGE_MODELS.find((m) => m.id === id) ??
    IMAGE_MODELS.find((m) => m.id === DEFAULT_ID) ??
    IMAGE_MODELS.find((m) => m.id === "gemini-2.5-flash-image") ??
    IMAGE_MODELS[0]
  );
}

/**
 * Which model is used when nobody picked one.
 *
 * Read once at module load and only on the server: in the browser this is
 * replaced with undefined at build time, and resolveModel then falls through
 * to the same hardcoded default the server would use.
 */
const DEFAULT_ID =
  typeof process === "undefined" ? undefined : process.env.GEMINI_IMAGE_MODEL;

export const DEFAULT_MODEL = resolveModel();
