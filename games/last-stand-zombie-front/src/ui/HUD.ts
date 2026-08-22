import { UiLayer, el } from './dom';
import { formatCompact, formatDuration } from '../util/format';

export interface HudModel {
  tierName: string;
  displayCount: number;
  combatPower: number;
  /** Fortschritt [0,1] innerhalb des Sektors. */
  sectorProgress: number;
  sectorIndex: number;
  elapsedSeconds: number;
}

/**
 * Run-HUD. In Phase 1 zeigt es Sektor, Distanz und Zeit; die Armee-Felder
 * sind bereits angelegt, werden aber erst ab Phase 3 mit echten Werten
 * gefuettert.
 */
export class HUD {
  private readonly layer: UiLayer;
  private readonly tierLabel: HTMLElement;
  private readonly countLabel: HTMLElement;
  private readonly powerLabel: HTMLElement;
  private readonly timeLabel: HTMLElement;
  private readonly sectorLabel: HTMLElement;
  private readonly progressFill: HTMLElement;

  constructor(parent: HTMLElement) {
    this.layer = new UiLayer(parent, 'hud');

    const top = this.layer.add(el('div', 'hud-top'));
    const left = el('div', 'hud-block');
    this.tierLabel = el('div', 'hud-tier', '—');
    this.countLabel = el('div', 'hud-count', '');
    left.appendChild(this.tierLabel);
    left.appendChild(this.countLabel);

    const right = el('div', 'hud-block hud-right');
    this.powerLabel = el('div', 'hud-power', '');
    this.timeLabel = el('div', 'hud-time', '0:00');
    right.appendChild(this.powerLabel);
    right.appendChild(this.timeLabel);

    top.appendChild(left);
    top.appendChild(right);

    const progress = this.layer.add(el('div', 'hud-progress'));
    this.sectorLabel = el('div', 'hud-sector', 'SECTOR 1');
    const bar = el('div', 'hud-bar');
    this.progressFill = el('i', 'hud-bar-fill');
    bar.appendChild(this.progressFill);
    progress.appendChild(this.sectorLabel);
    progress.appendChild(bar);
  }

  render(model: HudModel): void {
    this.tierLabel.textContent = model.tierName;
    this.countLabel.textContent = `×${formatCompact(model.displayCount)}`;
    this.powerLabel.textContent = `PWR ${formatCompact(model.combatPower)}`;
    this.timeLabel.textContent = formatDuration(model.elapsedSeconds);
    this.sectorLabel.textContent = `SECTOR ${model.sectorIndex + 1}`;
    this.progressFill.style.width = `${Math.round(model.sectorProgress * 100)}%`;
  }

  dispose(): void {
    this.layer.dispose();
  }
}
