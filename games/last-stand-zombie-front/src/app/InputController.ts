import type { InputState } from '../core/Types';
import { MOVEMENT } from '../config/gameBalance';
import { clamp } from '../util/math';

/**
 * Uebersetzt Maus, Touch und Tastatur in einen einheitlichen Eingabezustand.
 *
 * Steuermodell laut Spezifikation: ausschliesslich lateral, relativer Drag.
 * Relativ (nicht absolut) deshalb, weil der Daumen sonst genau dort liegen
 * muesste, wo die Armee steht — auf dem Handy die Sicht auf das Geschehen
 * verdeckt.
 */
export class InputController {
  private readonly state: InputState = { lateral: 0, active: false };

  private pointerId: number | null = null;
  private dragStartX = 0;
  private dragStartLateral = 0;
  private keyLeft = false;
  private keyRight = false;
  private attached = false;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  get lateral(): number {
    return this.state.lateral;
  }

  get isActive(): boolean {
    return this.state.active;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.reset();
  }

  reset(): void {
    this.state.lateral = 0;
    this.state.active = false;
    this.pointerId = null;
    this.keyLeft = false;
    this.keyRight = false;
  }

  /** Pro Simulationsschritt aufrufen — verarbeitet gehaltene Tasten. */
  update(dtSeconds: number): void {
    const keyAxis = (this.keyRight ? 1 : 0) - (this.keyLeft ? 1 : 0);
    if (keyAxis !== 0) {
      // Volle Fahrbahnbreite in etwa 0,7 s durchqueren.
      this.state.lateral = clamp(this.state.lateral + keyAxis * dtSeconds * 2.8, -1, 1);
    }
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    this.dragStartX = event.clientX;
    this.dragStartLateral = this.state.lateral;
    this.state.active = true;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    const travelPixels = Math.max(1, window.innerWidth * MOVEMENT.dragScreenTravel);
    const delta = (event.clientX - this.dragStartX) / travelPixels;
    this.state.lateral = clamp(this.dragStartLateral + delta * 2, -1, 1);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    this.pointerId = null;
    this.state.active = false;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
      this.keyLeft = true;
    } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
      this.keyRight = true;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
      this.keyLeft = false;
    } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
      this.keyRight = false;
    }
  };
}
