import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/EventBus';

describe('EventBus', () => {
  it('delivers payloads to every subscriber', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('run:distance', a);
    bus.on('run:distance', b);

    bus.emit('run:distance', { meters: 12 });

    expect(a).toHaveBeenCalledWith({ meters: 12 });
    expect(b).toHaveBeenCalledWith({ meters: 12 });
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.on('run:distance', handler);

    off();
    bus.emit('run:distance', { meters: 1 });

    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount('run:distance')).toBe(0);
  });

  it('runs a once-handler exactly one time', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('save:written', handler);

    bus.emit('save:written', {});
    bus.emit('save:written', {});

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps delivering when one handler throws', () => {
    const bus = new EventBus();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = vi.fn();
    bus.on('save:written', () => {
      throw new Error('boom');
    });
    bus.on('save:written', second);

    bus.emit('save:written', {});

    expect(second).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('is not disturbed by unsubscribing during emit', () => {
    const bus = new EventBus();
    const later = vi.fn();
    const off = bus.on('save:written', () => off());
    bus.on('save:written', later);

    bus.emit('save:written', {});

    expect(later).toHaveBeenCalledTimes(1);
  });
});
