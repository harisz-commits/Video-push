import { GAME_VERSION } from '../core/Config';

/** Aktuelle Schemaversion. Bei jeder inkompatiblen Aenderung erhoehen. */
export const CURRENT_SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  /** Version des Spiels, das zuletzt geschrieben hat — reine Diagnose. */
  gameVersion: string;
  meta: { coins: number; techParts: number; xp: number };
  /** upgradeId -> Level. Unbekannte IDs werden beim Laden verworfen. */
  upgrades: Record<string, number>;
  unlocks: string[];
  progress: { campaignSector: number; highestTierIndex: number };
  stats: {
    runs: number;
    kills: number;
    bestScore: number;
    bestEndlessSector: number;
  };
  settings: { audio: boolean; haptics: boolean };
  tutorialDone: boolean;
}

export function createDefaultSave(): SaveData {
  return {
    version: CURRENT_SAVE_VERSION,
    gameVersion: GAME_VERSION,
    meta: { coins: 0, techParts: 0, xp: 0 },
    upgrades: {},
    unlocks: ['campaign'],
    progress: { campaignSector: 0, highestTierIndex: 0 },
    stats: { runs: 0, kills: 0, bestScore: 0, bestEndlessSector: 0 },
    settings: { audio: true, haptics: true },
    tutorialDone: false,
  };
}

/**
 * Bringt beliebige Eingaben in eine gueltige `SaveData`-Form.
 *
 * Bewusst tolerant: fehlende oder kaputte Felder werden durch Defaults
 * ersetzt, statt das ganze Savegame zu verwerfen. Ein Spieler soll wegen
 * eines einzelnen fehlerhaften Feldes nicht seinen Fortschritt verlieren.
 */
export function normalizeSave(input: unknown): SaveData {
  const base = createDefaultSave();
  if (!isRecord(input)) return base;

  return {
    version: CURRENT_SAVE_VERSION,
    gameVersion: GAME_VERSION,
    meta: {
      coins: num(path(input, 'meta', 'coins'), base.meta.coins),
      techParts: num(path(input, 'meta', 'techParts'), base.meta.techParts),
      xp: num(path(input, 'meta', 'xp'), base.meta.xp),
    },
    upgrades: numberMap(input['upgrades']),
    unlocks: stringList(input['unlocks'], base.unlocks),
    progress: {
      campaignSector: num(
        path(input, 'progress', 'campaignSector'),
        base.progress.campaignSector,
      ),
      highestTierIndex: num(
        path(input, 'progress', 'highestTierIndex'),
        base.progress.highestTierIndex,
      ),
    },
    stats: {
      runs: num(path(input, 'stats', 'runs'), base.stats.runs),
      kills: num(path(input, 'stats', 'kills'), base.stats.kills),
      bestScore: num(path(input, 'stats', 'bestScore'), base.stats.bestScore),
      bestEndlessSector: num(
        path(input, 'stats', 'bestEndlessSector'),
        base.stats.bestEndlessSector,
      ),
    },
    settings: {
      audio: bool(path(input, 'settings', 'audio'), base.settings.audio),
      haptics: bool(path(input, 'settings', 'haptics'), base.settings.haptics),
    },
    tutorialDone: bool(input['tutorialDone'], base.tutorialDone),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function path(source: Record<string, unknown>, ...keys: string[]): unknown {
  let current: unknown = source;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const items = value.filter((entry): entry is string => typeof entry === 'string');
  return items.length > 0 ? [...new Set(items)] : [...fallback];
}

function numberMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry) && entry >= 0) {
      result[key] = Math.floor(entry);
    }
  }
  return result;
}
