import { BasePlatformService } from './BasePlatformService';
import { Emitter } from './Emitter';
import type {
  InterstitialAdResult,
  PlatformKind,
  RewardId,
  RewardedAdResult,
  Unsubscribe,
} from './PlatformService';

const SAVE_KEY = 'merge-factory:save';

export interface LocalPlatformOptions {
  /** Storage backend. Injectable so tests run without a DOM. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Language override; defaults to the browser language, then 'en'. */
  language?: string;
  /** Simulated host audio switch. */
  audioEnabled?: boolean;
  /** Probability [0..1] that a mock ad is available and completes. */
  adSuccessRate?: number;
  /** Artificial ad delay in ms, so ad-driven UI can be exercised locally. */
  adDelayMs?: number;
}

/**
 * Development / non-Playables adapter.
 *
 * Everything is local: localStorage for saves, mock ads, browser language,
 * manually driven pause/resume. This is what makes the whole game runnable
 * without YouTube (briefing §3) — `npm run dev` never touches the SDK.
 */
export class LocalPlatformService extends BasePlatformService {
  readonly kind: PlatformKind = 'local';

  private readonly storage: LocalPlatformOptions['storage'];
  private readonly languageOverride: string | undefined;
  private readonly adSuccessRate: number;
  private readonly adDelayMs: number;

  private audioEnabled: boolean;
  private readonly audioEmitter = new Emitter<boolean>();
  private readonly pauseEmitter = new Emitter<void>();
  private readonly resumeEmitter = new Emitter<void>();

  /** Highest score handed to `sendScore`. Handy for local verification. */
  lastScoreSent: number | null = null;

  constructor(options: LocalPlatformOptions = {}) {
    super();
    this.storage = options.storage !== undefined ? options.storage : safeLocalStorage();
    this.languageOverride = options.language;
    this.audioEnabled = options.audioEnabled ?? true;
    this.adSuccessRate = options.adSuccessRate ?? 1;
    this.adDelayMs = options.adDelayMs ?? 0;
  }

  protected onFirstFrameReady(): void {
    console.info('[local] firstFrameReady');
  }

  protected onGameReady(): void {
    console.info('[local] gameReady');
  }

  protected async readSave(): Promise<string | null> {
    return this.storage?.getItem(SAVE_KEY) ?? null;
  }

  protected async writeSave(data: string): Promise<void> {
    this.storage?.setItem(SAVE_KEY, data);
  }

  /** Test/dev helper: wipe the local save. */
  clearSave(): void {
    this.storage?.removeItem(SAVE_KEY);
  }

  async sendScore(score: number): Promise<void> {
    this.lastScoreSent = score;
    console.info('[local] sendScore', score);
  }

  async showInterstitial(): Promise<InterstitialAdResult> {
    await delay(this.adDelayMs);
    if (!this.rollAd()) return { shown: false, reason: 'unavailable' };
    console.info('[local] interstitial shown');
    return { shown: true };
  }

  async showRewardedAd(rewardId: RewardId): Promise<RewardedAdResult> {
    await delay(this.adDelayMs);
    if (!this.rollAd()) return { rewarded: false, reason: 'unavailable' };
    console.info('[local] rewarded ad completed', rewardId);
    return { rewarded: true };
  }

  getLanguage(): string {
    if (this.languageOverride) return this.languageOverride;
    if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
    return 'en';
  }

  isAudioEnabled(): boolean {
    return this.audioEnabled;
  }

  subscribeAudioChange(cb: (enabled: boolean) => void): Unsubscribe {
    return this.audioEmitter.subscribe(cb);
  }

  subscribePause(cb: () => void): Unsubscribe {
    return this.pauseEmitter.subscribe(cb);
  }

  subscribeResume(cb: () => void): Unsubscribe {
    return this.resumeEmitter.subscribe(cb);
  }

  logError(message: string, error?: unknown): void {
    console.error(`[local] ${message}`, error ?? '');
  }

  logWarning(message: string, detail?: unknown): void {
    console.warn(`[local] ${message}`, detail ?? '');
  }

  // --- Local-only simulation hooks -------------------------------------
  // Exposed on `window.__mergeFactory` in dev so pause/resume and host mute
  // can be exercised without YouTube.

  simulateAudioChange(enabled: boolean): void {
    if (this.audioEnabled === enabled) return;
    this.audioEnabled = enabled;
    this.audioEmitter.emit(enabled);
  }

  simulatePause(): void {
    this.pauseEmitter.emit(undefined as void);
  }

  simulateResume(): void {
    this.resumeEmitter.emit(undefined as void);
  }

  private rollAd(): boolean {
    return Math.random() < this.adSuccessRate;
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeLocalStorage(): LocalPlatformOptions['storage'] {
  try {
    // Private-mode Safari throws on access, not on use.
    if (typeof localStorage === 'undefined') return null;
    const probe = '__mf_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}
