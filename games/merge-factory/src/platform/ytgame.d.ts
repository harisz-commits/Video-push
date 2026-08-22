/**
 * Minimal typings for the YouTube Playables SDK, loaded via the script tag in
 * index.html. Only the surface the game actually touches is declared; every
 * call site treats these as "may be missing or may throw" regardless.
 *
 * Reference: https://developers.google.com/youtube/gaming/playables
 */

export interface YtGameSystem {
  getLanguage(): string;
  isAudioEnabled(): boolean;
  onAudioEnabledChange(cb: (enabled: boolean) => void): () => void;
  onPause(cb: () => void): () => void;
  onResume(cb: () => void): () => void;
}

export interface YtGameGame {
  firstFrameReady(): void;
  gameReady(): void;
  loadData(): Promise<string>;
  saveData(data: string): Promise<void>;
}

export interface YtGameEngagement {
  sendScore(payload: { value: number }): Promise<void>;
}

export interface YtGameAds {
  requestInterstitialAd(): Promise<void>;
  requestRewardedAd(): Promise<void>;
}

export interface YtGameHealth {
  logError(): void;
  logWarning(): void;
}

export interface YtGame {
  IN_PLAYABLES_ENV?: boolean;
  system?: YtGameSystem;
  game?: YtGameGame;
  engagement?: YtGameEngagement;
  ads?: YtGameAds;
  health?: YtGameHealth;
}

declare global {
  // eslint-disable-next-line no-var
  var ytgame: YtGame | undefined;
}

export {};
