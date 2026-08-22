import type { GameMode } from '../core/Types';
import { GAME_SUBTITLE, GAME_TITLE } from '../core/Config';
import { formatCompact } from '../util/format';
import { UiLayer, button, el } from './dom';

export interface MainMenuOptions {
  coins: number;
  techParts: number;
  bestScore: number;
  /** Welche Modi sind laut Spielstand freigeschaltet? */
  unlocked: ReadonlySet<GameMode>;
  onPlay: (mode: GameMode) => void;
}

const MODE_LABELS: Record<GameMode, { title: string; hint: string }> = {
  campaign: { title: 'Campaign', hint: 'Story sectors · guided difficulty' },
  survival: { title: 'Survival Run', hint: '2-5 minutes · full escalation' },
  endless: { title: 'Endless', hint: 'Score chase · never stops' },
};

/** Baut das Hauptmenue. Kennt weder Szenen noch Plattform. */
export function createMainMenu(parent: HTMLElement, options: MainMenuOptions): UiLayer {
  const layer = new UiLayer(parent, 'menu');

  const header = layer.add(el('div', 'menu-header'));
  header.appendChild(el('div', 'menu-title', GAME_TITLE));
  header.appendChild(el('div', 'menu-subtitle', GAME_SUBTITLE));

  const wallet = layer.add(el('div', 'menu-wallet'));
  wallet.appendChild(el('span', 'chip', `◎ ${formatCompact(options.coins)}`));
  wallet.appendChild(el('span', 'chip', `⚙ ${formatCompact(options.techParts)}`));
  if (options.bestScore > 0) {
    wallet.appendChild(el('span', 'chip', `★ ${formatCompact(options.bestScore)}`));
  }

  const modes = layer.add(el('div', 'menu-modes'));
  for (const mode of ['campaign', 'survival', 'endless'] as const) {
    const unlocked = options.unlocked.has(mode);
    const label = MODE_LABELS[mode];
    const entry = el('div', `mode-card${unlocked ? '' : ' locked'}`);
    const action = button(label.title, () => options.onPlay(mode), 'mode-btn');
    action.disabled = !unlocked;
    entry.appendChild(action);
    entry.appendChild(
      el('div', 'mode-hint', unlocked ? label.hint : 'Locked — finish a campaign run'),
    );
    modes.appendChild(entry);
  }

  layer.add(el('div', 'menu-footprint', 'Drag left and right to steer your squad.'));

  return layer;
}
