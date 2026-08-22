import { LocalPlatformService } from './LocalPlatformService';
import { YouTubePlatformService } from './YouTubePlatformService';
import type { PlatformService } from './PlatformService';
import type { YtGame } from './ytgame';

/**
 * Picks the platform adapter for this session.
 *
 * The check is deliberately paranoid: the SDK script may be absent (local dev),
 * blocked, still loading, or present but not in a Playables context. Anything
 * other than a confirmed `IN_PLAYABLES_ENV === true` means local mode — the
 * game must always come up rather than wait on a host that will never answer.
 */
export function readYtGame(scope: unknown = globalThis): YtGame | null {
  try {
    const candidate = (scope as { ytgame?: unknown }).ytgame;
    if (!candidate || typeof candidate !== 'object') return null;
    return candidate as YtGame;
  } catch {
    return null;
  }
}

export function isPlayablesEnvironment(scope: unknown = globalThis): boolean {
  return readYtGame(scope)?.IN_PLAYABLES_ENV === true;
}

export async function createPlatformService(
  scope: unknown = globalThis,
): Promise<PlatformService> {
  const sdk = readYtGame(scope);
  const service: PlatformService =
    sdk?.IN_PLAYABLES_ENV === true
      ? new YouTubePlatformService(sdk)
      : new LocalPlatformService();

  try {
    await service.initialize();
  } catch (error) {
    // initialize() is specified not to throw; if an adapter ever regresses,
    // a broken host must still not stop the game from booting.
    console.error('[platform] initialize failed, continuing', error);
  }
  return service;
}
