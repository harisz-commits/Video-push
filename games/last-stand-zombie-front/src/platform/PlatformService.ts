/**
 * Plattform-Abstraktion.
 *
 * Kein Gameplay-Code darf YouTube kennen. Alles, was ausserhalb des Spiels
 * liegt — Speichern, Werbung, Score, Lifecycle, Audio-Status — laeuft
 * ausschliesslich ueber dieses Interface.
 *
 * Regel: Keine Methode wirft. Fehlschlaege kommen als Ergebniswert zurueck
 * oder werden geloggt und still verschluckt. Ein kaputtes SDK darf niemals
 * eine Runde beenden.
 */

export type AdOutcome =
  | { status: 'shown' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

export type RewardedOutcome =
  | { status: 'rewarded' }
  | { status: 'dismissed'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

export type Unsubscribe = () => void;

export interface PlatformService {
  /** Kennung der Implementierung, nur fuer Logging/Debug-Anzeige. */
  readonly id: 'local' | 'youtube';

  /** Einmalig beim Start. Muss auch ohne SDK erfolgreich durchlaufen. */
  initialize(): Promise<void>;

  /** Erstes gerendertes Bild steht — Plattform darf den Ladescreen abbauen. */
  firstFrameReady(): void;

  /** Spiel ist vollstaendig interaktiv. */
  gameReady(): void;

  /** Rohen Savegame-String laden. `null`, wenn nichts gespeichert ist. */
  loadGame(): Promise<string | null>;

  /** Rohen Savegame-String schreiben. Liefert false bei Fehlschlag. */
  saveGame(data: string): Promise<boolean>;

  /** Score fuer Leaderboards melden. */
  sendScore(score: number): Promise<void>;

  showInterstitial(): Promise<AdOutcome>;

  showRewardedAd(): Promise<RewardedOutcome>;

  /** BCP-47-Sprachcode, z. B. "en" oder "de-DE". */
  getLanguage(): string;

  /** Darf das Spiel gerade Ton ausgeben? */
  isAudioEnabled(): boolean;

  subscribeAudioChange(handler: (enabled: boolean) => void): Unsubscribe;
  subscribePause(handler: () => void): Unsubscribe;
  subscribeResume(handler: () => void): Unsubscribe;

  logError(message: string, error?: unknown): void;
  logWarning(message: string): void;
}
