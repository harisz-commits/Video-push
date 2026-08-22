import type { Unsubscribe } from './PlatformService';

/**
 * Tiny typed callback list. Deliberately not an EventEmitter: subscriptions in
 * this codebase are always "one topic, one payload", and a listener that throws
 * must never break the other listeners or the host callback that triggered it.
 */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  subscribe(cb: (value: T) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  emit(value: T): void {
    for (const cb of [...this.listeners]) {
      try {
        cb(value);
      } catch (error) {
        console.error('[emitter] listener threw', error);
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }

  clear(): void {
    this.listeners.clear();
  }
}
