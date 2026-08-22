import { Emitter } from '@/platform/Emitter';

/**
 * The game's lifecycle (briefing §32). Transitions are explicit: anything not
 * in the table below is a programming error, not a runtime condition. Keeping
 * this table small and readable is the point — hidden or contradictory states
 * are exactly what it exists to prevent.
 */
export const GAME_STATES = [
  'BOOT',
  'LOADING',
  'LOADING_SAVE',
  'TUTORIAL',
  'PLAYING',
  'AD',
  'PAUSED',
] as const;

export type GameState = (typeof GAME_STATES)[number];

const TRANSITIONS: Record<GameState, readonly GameState[]> = {
  BOOT: ['LOADING'],
  LOADING: ['LOADING_SAVE'],
  LOADING_SAVE: ['TUTORIAL', 'PLAYING'],
  TUTORIAL: ['PLAYING', 'PAUSED'],
  // AD is entered from PLAYING only: never mid-tutorial, never mid-drag.
  PLAYING: ['AD', 'PAUSED', 'TUTORIAL'],
  AD: ['PLAYING', 'PAUSED'],
  // Resume returns to the state that was interrupted; see `resume()`.
  PAUSED: ['PLAYING', 'TUTORIAL', 'AD'],
};

export interface StateChange {
  from: GameState;
  to: GameState;
}

export class GameStateMachine {
  private current: GameState = 'BOOT';
  private beforePause: GameState | null = null;
  private readonly changes = new Emitter<StateChange>();

  get state(): GameState {
    return this.current;
  }

  /** Interaction is only legal while the player is actually in the game. */
  get acceptsInput(): boolean {
    return this.current === 'PLAYING' || this.current === 'TUTORIAL';
  }

  onChange(cb: (change: StateChange) => void) {
    return this.changes.subscribe(cb);
  }

  canTransition(to: GameState): boolean {
    return TRANSITIONS[this.current].includes(to);
  }

  transition(to: GameState): void {
    if (this.current === to) return;
    if (!this.canTransition(to)) {
      throw new Error(`Illegal state transition: ${this.current} -> ${to}`);
    }
    if (to === 'PAUSED') this.beforePause = this.current;
    const from = this.current;
    this.current = to;
    this.changes.emit({ from, to });
  }

  /** Convenience wrapper so pause handling has exactly one code path. */
  pause(): void {
    if (this.current === 'PAUSED') return;
    if (!this.canTransition('PAUSED')) return;
    this.transition('PAUSED');
  }

  /** Returns to whatever was interrupted, defaulting to PLAYING. */
  resume(): void {
    if (this.current !== 'PAUSED') return;
    const target = this.beforePause ?? 'PLAYING';
    this.beforePause = null;
    this.transition(target);
  }
}
