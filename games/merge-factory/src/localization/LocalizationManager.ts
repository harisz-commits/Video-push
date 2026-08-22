import { en, type TranslationKey, type TranslationTable } from './translations/en';
import { de } from './translations/de';

/**
 * All player-facing text goes through here (briefing §26). No component ever
 * holds a literal string.
 *
 * The locale comes exclusively from the platform (`getLanguage()`), never from
 * `navigator` directly — on YouTube the host is the only correct source.
 * Locales listed in SUPPORTED_LOCALES but not yet translated fall back to
 * English per key, so a partial translation degrades gracefully instead of
 * showing raw keys.
 */
export const SUPPORTED_LOCALES = ['en', 'de', 'es', 'fr', 'pt', 'tr', 'ja'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const FALLBACK_LOCALE: Locale = 'en';

const TABLES: Partial<Record<Locale, TranslationTable>> = { en, de };

/** 'de-AT' → 'de'; unknown or malformed tags → 'en'. */
export function normalizeLocale(tag: string | null | undefined): Locale {
  if (!tag) return FALLBACK_LOCALE;
  const base = tag.toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(base ?? '')
    ? (base as Locale)
    : FALLBACK_LOCALE;
}

export class LocalizationManager {
  private locale: Locale = FALLBACK_LOCALE;

  get currentLocale(): Locale {
    return this.locale;
  }

  setLocaleFromTag(tag: string | null | undefined): Locale {
    this.locale = normalizeLocale(tag);
    return this.locale;
  }

  /**
   * Look up a key. `params` are substituted as `{name}` placeholders.
   * A missing key returns the key itself — loud in dev, harmless in prod.
   */
  t(key: TranslationKey, params?: Record<string, string | number>): string {
    const table = TABLES[this.locale];
    const template = table?.[key] ?? en[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  }

  /** True when the locale has its own table rather than falling back. */
  hasTable(locale: Locale = this.locale): boolean {
    return TABLES[locale] !== undefined;
  }
}
