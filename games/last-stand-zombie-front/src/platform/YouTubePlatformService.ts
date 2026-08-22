import type {
  AdOutcome,
  PlatformService,
  RewardedOutcome,
  Unsubscribe,
} from './PlatformService';
import type { YtGameSdk } from './ytgame';

/**
 * Implementierung fuer YouTube Playables.
 *
 * Vorbereitet, aber bis Phase 8 nicht gegen ein reales SDK verifiziert
 * (PLAN.md A5). Zwei Konstruktionsprinzipien:
 *
 * 1. **Feature-Detection statt Annahme.** Jede SDK-Methode wird vor dem
 *    Aufruf geprueft; fehlt sie, gibt es einen definierten Fallback.
 * 2. **Nichts wirft.** Ein Fehler im SDK darf das Spiel nicht anhalten.
 *
 * Das SDK wird von der Plattform selbst injiziert; das Bundle laedt nichts
 * nach — das waere ein Verstoss gegen die Playables-Regeln.
 */
export class YouTubePlatformService implements PlatformService {
  readonly id = 'youtube' as const;

  private readonly sdk: YtGameSdk;
  private audioEnabled = true;
  private readonly audioHandlers = new Set<(enabled: boolean) => void>();
  private readonly pauseHandlers = new Set<() => void>();
  private readonly resumeHandlers = new Set<() => void>();

  constructor(sdk: YtGameSdk) {
    this.sdk = sdk;
  }

  /** Liefert das SDK, wenn die Seite in einem Playables-Container laeuft. */
  static detect(): YtGameSdk | null {
    return typeof window !== 'undefined' && window.ytgame ? window.ytgame : null;
  }

  async initialize(): Promise<void> {
    const system = this.sdk.system;
    this.audioEnabled = this.safe(() => system?.isAudioEnabled?.(), true) ?? true;

    // Die SDK-Callbacks werden genau einmal registriert und dann an die
    // internen Handler-Sets verteilt — so bleibt Mehrfach-Abo moeglich.
    this.safe(() =>
      system?.onAudioEnabledChange?.((enabled: boolean) => {
        this.audioEnabled = enabled;
        for (const handler of [...this.audioHandlers]) handler(enabled);
      }),
    );
    this.safe(() =>
      system?.onPause?.(() => {
        for (const handler of [...this.pauseHandlers]) handler();
      }),
    );
    this.safe(() =>
      system?.onResume?.(() => {
        for (const handler of [...this.resumeHandlers]) handler();
      }),
    );
  }

  firstFrameReady(): void {
    this.safe(() => this.sdk.game?.firstFrameReady?.());
  }

  gameReady(): void {
    this.safe(() => this.sdk.game?.gameReady?.());
  }

  async loadGame(): Promise<string | null> {
    const load = this.sdk.game?.loadData;
    if (!load) return null;
    try {
      const raw = await load();
      return raw && raw.length > 0 ? raw : null;
    } catch (error) {
      this.logError('loadData failed', error);
      return null;
    }
  }

  async saveGame(data: string): Promise<boolean> {
    const save = this.sdk.game?.saveData;
    if (!save) {
      this.logWarning('saveData unavailable — progress not persisted');
      return false;
    }
    try {
      await save(data);
      return true;
    } catch (error) {
      this.logError('saveData failed', error);
      return false;
    }
  }

  async sendScore(score: number): Promise<void> {
    const send = this.sdk.engagement?.sendScore;
    if (!send) return;
    try {
      await send({ value: score });
    } catch (error) {
      this.logError('sendScore failed', error);
    }
  }

  async showInterstitial(): Promise<AdOutcome> {
    const request = this.sdk.ads?.requestInterstitialAd;
    if (!request) return { status: 'unavailable', reason: 'no-ads-api' };
    try {
      await request();
      return { status: 'shown' };
    } catch (error) {
      return { status: 'failed', reason: describeError(error) };
    }
  }

  async showRewardedAd(): Promise<RewardedOutcome> {
    const request = this.sdk.ads?.requestRewardedAd;
    if (!request) return { status: 'unavailable', reason: 'no-ads-api' };
    try {
      // Aufloesen bedeutet: Werbung wurde vollstaendig gesehen.
      await request();
      return { status: 'rewarded' };
    } catch (error) {
      return { status: 'dismissed', reason: describeError(error) };
    }
  }

  getLanguage(): string {
    return (
      this.safe(() => this.sdk.system?.getLanguage?.(), 'en') ??
      navigator.language ??
      'en'
    );
  }

  isAudioEnabled(): boolean {
    return this.audioEnabled;
  }

  subscribeAudioChange(handler: (enabled: boolean) => void): Unsubscribe {
    this.audioHandlers.add(handler);
    return () => this.audioHandlers.delete(handler);
  }

  subscribePause(handler: () => void): Unsubscribe {
    this.pauseHandlers.add(handler);
    return () => this.pauseHandlers.delete(handler);
  }

  subscribeResume(handler: () => void): Unsubscribe {
    this.resumeHandlers.add(handler);
    return () => this.resumeHandlers.delete(handler);
  }

  logError(message: string, error?: unknown): void {
    console.error(`[game] ${message}`, error ?? '');
    this.safe(() =>
      this.sdk.game?.logError?.(
        error ? `${message}: ${describeError(error)}` : message,
      ),
    );
  }

  logWarning(message: string): void {
    console.warn(`[game] ${message}`);
    this.safe(() => this.sdk.game?.logWarning?.(message));
  }

  /** Fuehrt einen SDK-Aufruf aus und schluckt jeden Fehler. */
  private safe<T>(fn: () => T, fallback?: T): T | undefined {
    try {
      return fn();
    } catch (error) {
      console.warn('[platform] ytgame call failed', error);
      return fallback;
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
