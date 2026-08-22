import { createPhaserGame } from '@/game/Game';
import { GameContext } from '@/game/GameContext';
import { createPlatformService } from '@/platform/detectPlatform';
import { LocalPlatformService } from '@/platform/LocalPlatformService';
import { BRANDING } from '@/config/branding';

/**
 * Entry point.
 *
 * Order matters: the platform adapter is resolved and initialised *before*
 * Phaser starts, so the very first scene already has a working `platform`
 * (language, audio state, pause subscriptions) and so `firstFrameReady()` has
 * somewhere to go the moment a frame exists.
 */
async function bootstrap(): Promise<void> {
  const platform = await createPlatformService();
  const context = new GameContext(platform);

  console.info(
    `[${BRANDING.gameId}] platform=${platform.kind} locale=${context.i18n.currentLocale}`,
  );

  createPhaserGame(context);

  // Dev-only console handles for pause/resume and host-mute simulation.
  // `import.meta.env.DEV` is statically replaced, so this block is dropped
  // from the production bundle entirely.
  if (import.meta.env.DEV && platform instanceof LocalPlatformService) {
    (window as unknown as Record<string, unknown>).__mergeFactory = {
      pause: () => platform.simulatePause(),
      resume: () => platform.simulateResume(),
      mute: () => platform.simulateAudioChange(false),
      unmute: () => platform.simulateAudioChange(true),
      clearSave: () => platform.clearSave(),
      state: () => context.state.state,
    };
  }
}

void bootstrap().catch((error) => {
  // A failed bootstrap must still leave something on screen rather than a
  // blank canvas; the preloader text stays and the error is logged.
  console.error('[merge-factory] bootstrap failed', error);
});
