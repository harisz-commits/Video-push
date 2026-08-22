import type { PlatformService } from './PlatformService';
import { LocalPlatformService } from './LocalPlatformService';
import { YouTubePlatformService } from './YouTubePlatformService';

/**
 * Waehlt die passende Implementierung. Einzige Stelle im Projekt, die beide
 * Varianten kennt — der Rest des Spiels sieht nur `PlatformService`.
 */
export async function createPlatformService(): Promise<PlatformService> {
  const sdk = YouTubePlatformService.detect();
  const service: PlatformService = sdk
    ? new YouTubePlatformService(sdk)
    : new LocalPlatformService();
  await service.initialize();
  return service;
}
