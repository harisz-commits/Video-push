/**
 * Anwendungsweite Konstanten und ein gebuendelter Zugriff auf die
 * Balancing-Konfiguration. Spieltuning gehoert nach `src/config/`,
 * hier stehen nur Rahmenwerte der Anwendung selbst.
 */

/** Arbeitstitel — laut Spezifikation an genau einer Stelle austauschbar. */
export const GAME_TITLE = 'Last Stand';
export const GAME_SUBTITLE = 'Zombie Front';
export const GAME_ID = 'last-stand-zombie-front';
export const GAME_VERSION = '0.1.0';

/** true im Vite-Dev-Server, false im Produktionsbundle. */
export const IS_DEV = import.meta.env.DEV;

export const STORAGE_KEY = `${GAME_ID}:save`;

export { SIMULATION, MOVEMENT, DISPLAY_CAPS, CAMERA, RENDER, RUN, ARMY } from '../config/gameBalance';
export { UNIT_TIERS, MAX_TIER_INDEX, getTier, PROMOTION_SQUAD_SIZE } from '../config/unitTiers';
