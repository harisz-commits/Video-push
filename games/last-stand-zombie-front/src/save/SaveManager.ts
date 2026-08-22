import type { PlatformService } from '../platform/PlatformService';
import type { EventBus } from '../core/EventBus';
import {
  CURRENT_SAVE_VERSION,
  createDefaultSave,
  normalizeSave,
  type SaveData,
} from './SaveSchema';
import { migrate } from './migrations';

/** Wie lange nach einer Aenderung gebuendelt gewartet wird, bevor geschrieben wird. */
const FLUSH_DELAY_MS = 800;

/**
 * Laedt und schreibt den Spielstand ueber die Plattformschicht.
 *
 * Schreibvorgaenge werden gebuendelt (`markDirty` + Debounce), damit haeufige
 * kleine Aenderungen nicht in ebenso viele Plattform-Aufrufe muenden.
 */
export class SaveManager {
  private data: SaveData = createDefaultSave();
  private flushTimer: number | null = null;
  private writing = false;
  private pendingWrite = false;

  constructor(
    private readonly platform: PlatformService,
    private readonly bus: EventBus,
  ) {}

  get current(): SaveData {
    return this.data;
  }

  async load(): Promise<SaveData> {
    const raw = await this.platform.loadGame();
    this.data = this.parse(raw);
    return this.data;
  }

  /** Aenderung vormerken; geschrieben wird gebuendelt. */
  markDirty(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  /** Sofort schreiben (z. B. am Rundenende oder bei Pause). */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Ueberlappende Schreibvorgaenge vermeiden: der spaetere Aufruf gewinnt.
    if (this.writing) {
      this.pendingWrite = true;
      return;
    }
    this.writing = true;
    try {
      const ok = await this.platform.saveGame(JSON.stringify(this.data));
      if (ok) this.bus.emit('save:written', {});
    } finally {
      this.writing = false;
      if (this.pendingWrite) {
        this.pendingWrite = false;
        await this.flush();
      }
    }
  }

  /** Bequemer Zugriff: mutieren und automatisch vormerken. */
  update(mutate: (data: SaveData) => void): void {
    mutate(this.data);
    this.markDirty();
  }

  private parse(raw: string | null): SaveData {
    if (!raw) return createDefaultSave();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.platform.logError('save data is not valid JSON — starting fresh', error);
      return createDefaultSave();
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      this.platform.logWarning('save data has unexpected shape — starting fresh');
      return createDefaultSave();
    }

    const record = parsed as Record<string, unknown>;
    const version = typeof record['version'] === 'number' ? record['version'] : 0;

    if (version > CURRENT_SAVE_VERSION) {
      // Ein neuerer Client hat geschrieben. Raten waere gefaehrlicher als
      // ein sauberer Neustart, also nicht migrieren.
      this.platform.logWarning(
        `save version ${version} is newer than supported ${CURRENT_SAVE_VERSION} — starting fresh`,
      );
      return createDefaultSave();
    }

    try {
      const migrated = migrate(record, version, CURRENT_SAVE_VERSION);
      return normalizeSave(migrated);
    } catch (error) {
      this.platform.logError('save migration failed — starting fresh', error);
      return createDefaultSave();
    }
  }
}
