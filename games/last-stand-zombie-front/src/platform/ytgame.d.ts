/**
 * Angenommene Form des YouTube-Playables-SDK (`window.ytgame`).
 *
 * ACHTUNG: Diese Deklaration ist gegen die oeffentlich dokumentierte
 * Oberflaeche geschrieben und in Phase 8 gegen die reale SDK-Doku zu
 * verifizieren (PLAN.md Annahme A5). Alle Felder sind optional, damit der
 * YouTubePlatformService rein per Feature-Detection arbeitet und niemals
 * wirft, wenn eine Methode fehlt oder umbenannt wurde.
 */
export interface YtGameSdk {
  SDK_VERSION?: string;
  game?: {
    firstFrameReady?: () => void;
    gameReady?: () => void;
    loadData?: () => Promise<string>;
    saveData?: (data: string) => Promise<void>;
    logError?: (message: string) => void;
    logWarning?: (message: string) => void;
  };
  engagement?: {
    sendScore?: (payload: { value: number }) => Promise<void>;
  };
  ads?: {
    requestInterstitialAd?: () => Promise<void>;
    requestRewardedAd?: () => Promise<void>;
  };
  system?: {
    getLanguage?: () => string;
    isAudioEnabled?: () => boolean;
    onAudioEnabledChange?: (handler: (enabled: boolean) => void) => void;
    onPause?: (handler: () => void) => void;
    onResume?: (handler: () => void) => void;
  };
}

declare global {
  interface Window {
    ytgame?: YtGameSdk;
  }
}
