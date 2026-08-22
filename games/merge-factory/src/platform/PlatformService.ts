/**
 * The single seam between the game and whatever host it runs on.
 *
 * Gameplay code depends on this interface and never on `ytgame`, `window` or
 * `localStorage`. Adding a new host (Playgama, a portal, a native shell) means
 * adding one implementation, not touching gameplay.
 *
 * Contract every implementation must honour:
 *   - No method throws. Ever. Failures resolve to a neutral value instead, so
 *     a broken host API can never take the game down (briefing §35).
 *   - `firstFrameReady()` and `gameReady()` are idempotent — the host is
 *     notified at most once, no matter how often callers ask.
 *   - `saveGame()` is refused until `loadGame()` has completed at least once.
 */

/** Result of a rewarded ad request. `rewarded` gates the actual reward. */
export interface RewardedAdResult {
  /** True only when the ad ran to completion and the reward is earned. */
  rewarded: boolean;
  /** Machine-readable reason when `rewarded` is false. For logs, not for UI. */
  reason?: 'dismissed' | 'unavailable' | 'error' | 'not-ready';
}

/** Result of an interstitial ad request. */
export interface InterstitialAdResult {
  shown: boolean;
  reason?: 'unavailable' | 'error' | 'not-ready';
}

/** Reward identifiers. Fixed, human-readable, never user-specific (§15). */
export const REWARD_IDS = [
  'double-order-reward',
  'generator-boost',
  'free-shuffle',
  'board-rescue',
] as const;

export type RewardId = (typeof REWARD_IDS)[number];

/** Unsubscribe handle returned by every `subscribe*` method. */
export type Unsubscribe = () => void;

export type PlatformKind = 'youtube' | 'local';

export interface PlatformService {
  readonly kind: PlatformKind;

  /** Prepare the host connection. Resolves even when the host is broken. */
  initialize(): Promise<void>;

  /** Tell the host a visible frame has been painted. Idempotent (§33). */
  firstFrameReady(): void;

  /** Tell the host the player can actually interact. Idempotent (§34). */
  gameReady(): void;

  /** Load the raw save payload. `null` means "no save", never an error. */
  loadGame(): Promise<string | null>;

  /** Persist the raw save payload. Resolves false when it did not stick. */
  saveGame(data: string): Promise<boolean>;

  /** Submit a highscore. Integers only; callers debounce (§25). */
  sendScore(score: number): Promise<void>;

  showInterstitial(): Promise<InterstitialAdResult>;

  showRewardedAd(rewardId: RewardId): Promise<RewardedAdResult>;

  /** BCP-47-ish language tag from the host. Falls back to 'en'. */
  getLanguage(): string;

  /** Host-level audio switch. The host always wins over in-game sliders (§22). */
  isAudioEnabled(): boolean;

  subscribeAudioChange(cb: (enabled: boolean) => void): Unsubscribe;

  subscribePause(cb: () => void): Unsubscribe;

  subscribeResume(cb: () => void): Unsubscribe;

  logError(message: string, error?: unknown): void;

  logWarning(message: string, detail?: unknown): void;
}
