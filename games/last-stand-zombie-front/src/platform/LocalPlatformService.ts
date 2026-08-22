import type {
  AdOutcome,
  PlatformService,
  RewardedOutcome,
  Unsubscribe,
} from './PlatformService';
import { STORAGE_KEY } from '../core/Config';

/**
 * Implementierung fuer lokale Entwicklung und Browser-Tests.
 *
 * - Speichern ueber localStorage
 * - Werbung wird mit realistischer Verzoegerung gemockt
 * - Pause/Resume kommt von `visibilitychange`, zusaetzlich per Taste ausloesbar
 *   (F9 = Pause umschalten, F10 = Audio umschalten)
 */
export class LocalPlatformService implements PlatformService {
  readonly id = 'local' as const;

  private audioEnabled = true;
  private paused = false;
  private readonly audioHandlers = new Set<(enabled: boolean) => void>();
  private readonly pauseHandlers = new Set<() => void>();
  private readonly resumeHandlers = new Set<() => void>();

  async initialize(): Promise<void> {
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('keydown', this.onDebugKey);
    console.info('[platform] local service ready (F9 pause, F10 audio)');
  }

  firstFrameReady(): void {
    console.info('[platform] firstFrameReady');
  }

  gameReady(): void {
    console.info('[platform] gameReady');
  }

  async loadGame(): Promise<string | null> {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      this.logError('localStorage read failed', error);
      return null;
    }
  }

  async saveGame(data: string): Promise<boolean> {
    try {
      window.localStorage.setItem(STORAGE_KEY, data);
      return true;
    } catch (error) {
      this.logError('localStorage write failed', error);
      return false;
    }
  }

  async sendScore(score: number): Promise<void> {
    console.info(`[platform] score submitted: ${score}`);
  }

  async showInterstitial(): Promise<AdOutcome> {
    console.info('[platform] interstitial (mock)');
    this.emitPause();
    await delay(700);
    this.emitResume();
    return { status: 'shown' };
  }

  async showRewardedAd(): Promise<RewardedOutcome> {
    console.info('[platform] rewarded ad (mock)');
    this.emitPause();
    await delay(1200);
    this.emitResume();
    return { status: 'rewarded' };
  }

  getLanguage(): string {
    return navigator.language || 'en';
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
  }

  logWarning(message: string): void {
    console.warn(`[game] ${message}`);
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('keydown', this.onDebugKey);
    this.audioHandlers.clear();
    this.pauseHandlers.clear();
    this.resumeHandlers.clear();
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.emitPause();
    else this.emitResume();
  };

  private readonly onDebugKey = (event: KeyboardEvent): void => {
    if (event.key === 'F9') {
      event.preventDefault();
      if (this.paused) this.emitResume();
      else this.emitPause();
    } else if (event.key === 'F10') {
      event.preventDefault();
      this.setAudioEnabled(!this.audioEnabled);
    }
  };

  private setAudioEnabled(enabled: boolean): void {
    if (this.audioEnabled === enabled) return;
    this.audioEnabled = enabled;
    console.info(`[platform] audio ${enabled ? 'enabled' : 'muted'}`);
    for (const handler of [...this.audioHandlers]) handler(enabled);
  }

  private emitPause(): void {
    if (this.paused) return;
    this.paused = true;
    for (const handler of [...this.pauseHandlers]) handler();
  }

  private emitResume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const handler of [...this.resumeHandlers]) handler();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
