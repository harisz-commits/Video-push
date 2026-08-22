import Phaser from 'phaser';
import { THEME } from '@/config/theme';
import { BootScene } from '@/scenes/BootScene';
import { LoadingScene } from '@/scenes/LoadingScene';
import { GameScene } from '@/scenes/GameScene';
import type { GameContext } from './GameContext';

export const GAME_ROOT_ID = 'game-root';

/**
 * Phaser bootstrap.
 *
 * `Scale.RESIZE` rather than `FIT`: the game has no fixed design resolution.
 * Every scene lays itself out from the live canvas size via solveLayout(), so
 * a letterboxed FIT would only waste screen space and force a compromise
 * between portrait and landscape.
 */
export function createPhaserGame(context: GameContext): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: GAME_ROOT_ID,
    backgroundColor: THEME.bg,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: '100%',
      height: '100%',
    },
    // Capped at 2 so high-DPI phones do not pay for 3× pixel counts.
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    render: { antialias: true, powerPreference: 'high-performance' },
    audio: { disableWebAudio: false },
    // No physics: merging is grid logic, not simulation.
    scene: [BootScene, LoadingScene, GameScene],
    banner: false,
  } as Phaser.Types.Core.GameConfig);

  // Scenes reach the context through the registry rather than imports, which
  // keeps them constructible by Phaser and injectable in tests.
  game.registry.set('context', context);
  context.attachPhaser(game);
  return game;
}
