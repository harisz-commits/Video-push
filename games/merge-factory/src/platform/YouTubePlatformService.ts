import { BasePlatformService } from './BasePlatformService';
import { Emitter } from './Emitter';
import type {
  InterstitialAdResult,
  PlatformKind,
  RewardId,
  RewardedAdResult,
  Unsubscribe,
} from './PlatformService';
import type { YtGame } from './ytgame';

/**
 * YouTube Playables adapter.
 *
 * Design rule for this file: **nothing here may throw and nothing here may
 * hang the game.** Every SDK entry point is optional-chained, wrapped and
 * given a defined fallback, because a host API that is missing, renamed or
 * failing is a normal condition, not an exceptional one (briefing §35).
 *
 * The audio state is cached and refreshed from the change callback rather than
 * polled: `isAudioEnabled()` is read on every sound, and an SDK call per sound
 * effect would be wasteful.
 */
export class YouTubePlatformService extends BasePlatformService {
  readonly kind: PlatformKind = 'youtube';

  private readonly sdk: YtGame;

  private audioEnabled = true;
  private readonly audioEmitter = new Emitter<boolean>();
  private readonly pauseEmitter = new Emitter<void>();
  private readonly resumeEmitter = new Emitter<void>();

  private hostUnsubscribes: Unsubscribe[] = [];

  constructor(sdk: YtGame) {
    super();
    this.sdk = sdk;
  }

  override async initialize(): Promise<void> {
    this.audioEnabled = this.readAudioEnabled();

    // The SDK returns an unsubscribe function, but older builds returned void.
    // Store whatever comes back only if it is callable.
    this.bindHost(() =>
      this.sdk.system?.onAudioEnabledChange((enabled) => {
        this.audioEnabled = enabled;
        this.audioEmitter.emit(enabled);
      }),
    );
    this.bindHost(() => this.sdk.system?.onPause(() => this.pauseEmitter.emit(undefined as void)));
    this.bindHost(() => this.sdk.system?.onResume(() => this.resumeEmitter.emit(undefined as void)));
  }

  /** Drop all host subscriptions. Used on teardown and by tests. */
  dispose(): void {
    for (const off of this.hostUnsubscribes) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.hostUnsubscribes = [];
  }

  protected onFirstFrameReady(): void {
    this.guard('firstFrameReady', () => this.sdk.game?.firstFrameReady());
  }

  protected onGameReady(): void {
    this.guard('gameReady', () => this.sdk.game?.gameReady());
  }

  protected async readSave(): Promise<string | null> {
    const load = this.sdk.game?.loadData;
    if (!load) return null;
    const raw = await load.call(this.sdk.game);
    // The SDK resolves with '' when nothing was ever stored.
    return raw ? raw : null;
  }

  protected async writeSave(data: string): Promise<void> {
    const save = this.sdk.game?.saveData;
    if (!save) throw new Error('ytgame.game.saveData unavailable');
    await save.call(this.sdk.game, data);
  }

  async sendScore(score: number): Promise<void> {
    const send = this.sdk.engagement?.sendScore;
    if (!send) return;
    try {
      // Integers only (§25).
      await send.call(this.sdk.engagement, { value: Math.max(0, Math.floor(score)) });
    } catch (error) {
      // A rejected score must never surface to the player.
      this.logWarning('sendScore failed', error);
    }
  }

  async showInterstitial(): Promise<InterstitialAdResult> {
    const request = this.sdk.ads?.requestInterstitialAd;
    if (!request) return { shown: false, reason: 'not-ready' };
    try {
      await request.call(this.sdk.ads);
      return { shown: true };
    } catch (error) {
      this.logWarning('interstitial unavailable', error);
      return { shown: false, reason: 'unavailable' };
    }
  }

  async showRewardedAd(rewardId: RewardId): Promise<RewardedAdResult> {
    const request = this.sdk.ads?.requestRewardedAd;
    if (!request) return { rewarded: false, reason: 'not-ready' };
    try {
      await request.call(this.sdk.ads);
      // Resolution means the ad ran to completion; only then is the reward due.
      return { rewarded: true };
    } catch (error) {
      this.logWarning(`rewarded ad not completed (${rewardId})`, error);
      return { rewarded: false, reason: 'dismissed' };
    }
  }

  getLanguage(): string {
    try {
      return this.sdk.system?.getLanguage() || 'en';
    } catch (error) {
      this.logWarning('getLanguage failed', error);
      return 'en';
    }
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
    console.error(`[youtube] ${message}`, error ?? '');
    // Health APIs take no payload — no player data ever leaves the game (§29).
    this.guard('health.logError', () => this.sdk.health?.logError());
  }

  logWarning(message: string, detail?: unknown): void {
    console.warn(`[youtube] ${message}`, detail ?? '');
    this.guard('health.logWarning', () => this.sdk.health?.logWarning());
  }

  private readAudioEnabled(): boolean {
    try {
      return this.sdk.system?.isAudioEnabled() ?? true;
    } catch {
      return true;
    }
  }

  private bindHost(subscribe: () => unknown): void {
    try {
      const off = subscribe();
      if (typeof off === 'function') this.hostUnsubscribes.push(off as Unsubscribe);
    } catch (error) {
      console.warn('[youtube] host subscription failed', error);
    }
  }

  private guard(label: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      console.warn(`[youtube] ${label} failed`, error);
    }
  }
}
