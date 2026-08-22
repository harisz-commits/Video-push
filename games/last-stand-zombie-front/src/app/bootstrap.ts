import { App } from './App';
import { createPlatformService } from '../platform/createPlatformService';
import { GAME_TITLE, GAME_VERSION } from '../core/Config';

/**
 * Startpunkt der Anwendung: Plattform waehlen, App aufbauen, loslaufen.
 *
 * Faellt hier etwas aus, bekommt der Spieler eine lesbare Meldung statt eines
 * schwarzen Bildschirms — im Playables-Container gibt es keine Konsole.
 */
export async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('render-canvas');
  const uiRoot = document.getElementById('ui-root');
  if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
    throw new Error('Required DOM nodes are missing from index.html');
  }

  try {
    const platform = await createPlatformService();
    console.info(`${GAME_TITLE} ${GAME_VERSION} · platform: ${platform.id}`);
    const app = new App(canvas, uiRoot, platform);
    await app.start();
    // Beim Verlassen der Seite noch schnell speichern.
    window.addEventListener('pagehide', () => app.dispose(), { once: true });
  } catch (error) {
    console.error('[bootstrap] fatal', error);
    showFatalError(error);
  }
}

function showFatalError(error: unknown): void {
  const splash = document.getElementById('boot-splash');
  if (!splash) return;
  splash.classList.remove('hidden');
  splash.innerHTML = '';
  const message = document.createElement('div');
  message.className = 'boot-error';
  message.textContent =
    error instanceof Error ? `Failed to start: ${error.message}` : 'Failed to start.';
  splash.appendChild(message);
}
