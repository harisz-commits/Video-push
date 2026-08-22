import type { PlatformKind, PlatformService, Unsubscribe } from './PlatformService';

/**
 * Shared machinery for every platform adapter.
 *
 * The two guarantees the briefing calls out most loudly live here, so no
 * adapter can forget them:
 *
 *   1. `firstFrameReady()` / `gameReady()` reach the host at most once (§33/§34).
 *   2. `saveGame()` is refused until `loadGame()` has finished at least once
 *      (§24). This is the single most damaging bug class in a save-backed
 *      merge game: an autosave that lands before the load returns would
 *      overwrite a real save with an empty board. Refusing is deliberately
 *      chosen over buffering — a buffered write would still race with the
 *      load result.
 */
export abstract class BasePlatformService implements PlatformService {
  abstract readonly kind: PlatformKind;

  private firstFrameSent = false;
  private gameReadySent = false;
  private loadCompleted = false;

  async initialize(): Promise<void> {
    // Adapters override when they need to wait for the host.
  }

  firstFrameReady(): void {
    if (this.firstFrameSent) return;
    this.firstFrameSent = true;
    this.onFirstFrameReady();
  }

  gameReady(): void {
    if (this.gameReadySent) return;
    this.gameReadySent = true;
    this.onGameReady();
  }

  async loadGame(): Promise<string | null> {
    try {
      return await this.readSave();
    } catch (error) {
      this.logError('platform.loadGame failed', error);
      return null;
    } finally {
      // Even a failed load unseals saving: a host that cannot read is not a
      // reason to lock the player out of ever writing.
      this.loadCompleted = true;
    }
  }

  async saveGame(data: string): Promise<boolean> {
    if (!this.loadCompleted) {
      this.logWarning('platform.saveGame refused: load has not completed yet');
      return false;
    }
    try {
      await this.writeSave(data);
      return true;
    } catch (error) {
      this.logError('platform.saveGame failed', error);
      return false;
    }
  }

  /** True once `loadGame()` has settled. Exposed for the save layer and tests. */
  get isSaveUnsealed(): boolean {
    return this.loadCompleted;
  }

  protected abstract onFirstFrameReady(): void;
  protected abstract onGameReady(): void;
  protected abstract readSave(): Promise<string | null>;
  protected abstract writeSave(data: string): Promise<void>;

  abstract sendScore(score: number): Promise<void>;
  abstract showInterstitial(): ReturnType<PlatformService['showInterstitial']>;
  abstract showRewardedAd(
    rewardId: Parameters<PlatformService['showRewardedAd']>[0],
  ): ReturnType<PlatformService['showRewardedAd']>;
  abstract getLanguage(): string;
  abstract isAudioEnabled(): boolean;
  abstract subscribeAudioChange(cb: (enabled: boolean) => void): Unsubscribe;
  abstract subscribePause(cb: () => void): Unsubscribe;
  abstract subscribeResume(cb: () => void): Unsubscribe;
  abstract logError(message: string, error?: unknown): void;
  abstract logWarning(message: string, detail?: unknown): void;
}
