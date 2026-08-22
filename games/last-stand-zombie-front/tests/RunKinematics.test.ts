import { describe, expect, it } from 'vitest';
import { RunKinematics } from '../src/run/RunKinematics';
import { MOVEMENT } from '../src/config/gameBalance';

const STEP = 1 / 60;

function simulate(kinematics: RunKinematics, input: number, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) kinematics.update(input, STEP);
}

describe('RunKinematics', () => {
  it('advances forward at the configured speed', () => {
    const k = new RunKinematics();
    simulate(k, 0, 1);
    expect(k.distance).toBeCloseTo(MOVEMENT.forwardSpeed, 1);
  });

  it('never leaves the lane, even at extreme input', () => {
    const k = new RunKinematics();
    simulate(k, 99, 3);
    expect(k.x).toBeLessThanOrEqual(MOVEMENT.laneHalfWidth + 1e-6);
    simulate(k, -99, 3);
    expect(k.x).toBeGreaterThanOrEqual(-MOVEMENT.laneHalfWidth - 1e-6);
  });

  it('reaches the lane edge within a second of full input', () => {
    const k = new RunKinematics();
    simulate(k, 1, 1);
    expect(k.normalizedX).toBeGreaterThan(0.9);
  });

  it('eases instead of teleporting', () => {
    const k = new RunKinematics();
    k.update(1, STEP);
    // Nach einem einzigen Schritt darf die Armee nur einen Bruchteil der
    // Fahrbahn zurueckgelegt haben — sonst faehlt sich die Steuerung
    // gummiartig an.
    expect(k.x).toBeLessThan(MOVEMENT.laneHalfWidth * 0.2);
    expect(k.x).toBeGreaterThan(0);
  });

  it('reports lateral velocity with the correct sign', () => {
    const k = new RunKinematics();
    simulate(k, 1, 0.3);
    expect(k.lateralVelocity).toBeGreaterThan(0);
    simulate(k, -1, 0.3);
    expect(k.lateralVelocity).toBeLessThan(0);
  });

  it('is framerate independent within tolerance', () => {
    const fast = new RunKinematics();
    for (let t = 0; t < 2; t += 1 / 120) fast.update(1, 1 / 120);
    const slow = new RunKinematics();
    for (let t = 0; t < 2; t += 1 / 30) slow.update(1, 1 / 30);
    expect(Math.abs(fast.x - slow.x)).toBeLessThan(0.05);
    expect(Math.abs(fast.distance - slow.distance)).toBeLessThan(0.5);
  });

  it('resets to the starting state', () => {
    const k = new RunKinematics();
    simulate(k, 1, 2);
    k.reset();
    expect(k.distance).toBe(0);
    expect(k.x).toBe(0);
    expect(k.lateralVelocity).toBe(0);
  });
});
