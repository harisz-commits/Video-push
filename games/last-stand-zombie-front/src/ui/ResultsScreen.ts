import type { RunResult } from '../core/Types';
import { UiLayer, button, el } from './dom';
import { formatCompact, formatDuration } from '../util/format';

export interface ResultsOptions {
  result: RunResult;
  onContinue: () => void;
  onRetry: () => void;
}

export function createResultsScreen(parent: HTMLElement, options: ResultsOptions): UiLayer {
  const { result } = options;
  const layer = new UiLayer(parent, 'results');

  layer.add(el('div', 'results-title', result.victory ? 'SECTOR SECURED' : 'OVERRUN'));
  layer.add(el('div', 'results-score', formatCompact(result.score)));

  const rows: Array<[string, string]> = [
    ['Sectors cleared', String(result.stats.sectorsCleared)],
    ['Zombies killed', formatCompact(result.stats.kills)],
    ['Bosses down', String(result.stats.bossesKilled)],
    ['Peak power', formatCompact(result.stats.peakCombatPower)],
    ['Coins earned', formatCompact(result.stats.coinsEarned)],
    ['Time', formatDuration(result.stats.durationSeconds)],
  ];

  const table = layer.add(el('div', 'results-table'));
  for (const [label, value] of rows) {
    const row = el('div', 'results-row');
    row.appendChild(el('span', 'results-label', label));
    row.appendChild(el('span', 'results-value', value));
    table.appendChild(row);
  }

  const actions = layer.add(el('div', 'results-actions'));
  actions.appendChild(button('Retry', options.onRetry, 'secondary'));
  actions.appendChild(button('Continue', options.onContinue, 'primary'));

  return layer;
}
