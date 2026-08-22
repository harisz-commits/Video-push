import { describe, expect, it } from 'vitest';
import {
  FALLBACK_LOCALE,
  LocalizationManager,
  normalizeLocale,
} from '@/localization/LocalizationManager';
import { en } from '@/localization/translations/en';
import { de } from '@/localization/translations/de';

describe('normalizeLocale', () => {
  it('reduces regional tags to a supported base locale', () => {
    expect(normalizeLocale('de-DE')).toBe('de');
    expect(normalizeLocale('pt_BR')).toBe('pt');
    expect(normalizeLocale('JA')).toBe('ja');
  });

  it('falls back to English for unknown or missing tags', () => {
    for (const tag of ['', null, undefined, 'kl-GL', '???']) {
      expect(normalizeLocale(tag)).toBe(FALLBACK_LOCALE);
    }
  });
});

describe('LocalizationManager', () => {
  it('returns translated text for a translated locale', () => {
    const i18n = new LocalizationManager();
    i18n.setLocaleFromTag('de-AT');
    expect(i18n.currentLocale).toBe('de');
    expect(i18n.t('board.full')).toBe(de['board.full']);
  });

  it('falls back to English for a supported-but-untranslated locale', () => {
    const i18n = new LocalizationManager();
    i18n.setLocaleFromTag('ja');
    expect(i18n.currentLocale).toBe('ja');
    expect(i18n.hasTable()).toBe(false);
    expect(i18n.t('board.full')).toBe(en['board.full']);
  });

  it('substitutes named parameters', () => {
    const i18n = new LocalizationManager();
    expect(i18n.t('orders.reward', { coins: 250 })).toBe('+250 coins');
    expect(i18n.t('orders.need', { count: 2, item: 'Gear' })).toBe('Need 2× Gear');
  });

  it('leaves placeholders alone when no value is supplied', () => {
    const i18n = new LocalizationManager();
    expect(i18n.t('orders.reward')).toBe('+{coins} coins');
    expect(i18n.t('orders.reward', { other: 1 })).toBe('+{coins} coins');
  });

  it('keeps the German table complete against the English key master', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(de)) {
      expect(value.length, `empty translation for ${key}`).toBeGreaterThan(0);
    }
  });
});
