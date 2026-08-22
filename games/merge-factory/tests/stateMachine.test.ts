import { describe, expect, it, vi } from 'vitest';
import { GameStateMachine } from '@/game/GameStateMachine';

/** Walks the machine to PLAYING the way the real boot sequence does. */
function playing(): GameStateMachine {
  const sm = new GameStateMachine();
  sm.transition('LOADING');
  sm.transition('LOADING_SAVE');
  sm.transition('PLAYING');
  return sm;
}

describe('GameStateMachine', () => {
  it('starts in BOOT and follows the boot sequence', () => {
    const sm = new GameStateMachine();
    expect(sm.state).toBe('BOOT');
    sm.transition('LOADING');
    sm.transition('LOADING_SAVE');
    sm.transition('TUTORIAL');
    expect(sm.state).toBe('TUTORIAL');
  });

  it('rejects transitions that are not in the table', () => {
    const sm = new GameStateMachine();
    expect(() => sm.transition('PLAYING')).toThrow(/Illegal state transition/);
    expect(sm.state).toBe('BOOT');
  });

  it('never enters AD from the tutorial (§16: no ads during onboarding)', () => {
    const sm = new GameStateMachine();
    sm.transition('LOADING');
    sm.transition('LOADING_SAVE');
    sm.transition('TUTORIAL');
    expect(sm.canTransition('AD')).toBe(false);
    expect(() => sm.transition('AD')).toThrow();
  });

  it('treats a transition to the current state as a no-op', () => {
    const sm = playing();
    const listener = vi.fn();
    sm.onChange(listener);
    sm.transition('PLAYING');
    expect(listener).not.toHaveBeenCalled();
  });

  it('resumes into the state that was interrupted', () => {
    const sm = new GameStateMachine();
    sm.transition('LOADING');
    sm.transition('LOADING_SAVE');
    sm.transition('TUTORIAL');

    sm.pause();
    expect(sm.state).toBe('PAUSED');
    sm.resume();
    expect(sm.state).toBe('TUTORIAL');

    sm.transition('PLAYING');
    sm.transition('AD');
    sm.pause();
    sm.resume();
    expect(sm.state).toBe('AD');
  });

  it('ignores pause/resume when they cannot apply', () => {
    const sm = new GameStateMachine();
    sm.pause(); // BOOT cannot pause
    expect(sm.state).toBe('BOOT');

    const running = playing();
    running.resume(); // not paused
    expect(running.state).toBe('PLAYING');

    running.pause();
    running.pause(); // already paused
    expect(running.state).toBe('PAUSED');
  });

  it('only accepts input while the player is in the game', () => {
    const sm = new GameStateMachine();
    expect(sm.acceptsInput).toBe(false);
    sm.transition('LOADING');
    sm.transition('LOADING_SAVE');
    expect(sm.acceptsInput).toBe(false);
    sm.transition('PLAYING');
    expect(sm.acceptsInput).toBe(true);
    sm.transition('AD');
    expect(sm.acceptsInput).toBe(false);
    sm.pause();
    expect(sm.acceptsInput).toBe(false);
  });

  it('notifies listeners with from/to', () => {
    const sm = new GameStateMachine();
    const seen: string[] = [];
    sm.onChange(({ from, to }) => seen.push(`${from}->${to}`));
    sm.transition('LOADING');
    sm.transition('LOADING_SAVE');
    expect(seen).toEqual(['BOOT->LOADING', 'LOADING->LOADING_SAVE']);
  });
});
