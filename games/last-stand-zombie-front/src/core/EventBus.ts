import type { GameEventMap, GameEventName } from './Types';

export type Unsubscribe = () => void;

type Handler<K extends GameEventName> = (payload: GameEventMap[K]) => void;

/**
 * Minimaler, typisierter Event-Bus. Systeme publizieren, Szenen und UI
 * abonnieren — so kennen sich Systeme untereinander nicht.
 *
 * Handler, die waehrend eines `emit` hinzukommen oder wegfallen, wirken erst
 * beim naechsten `emit`: es wird ueber eine Kopie der Liste iteriert.
 */
export class EventBus {
  private readonly handlers = new Map<GameEventName, Set<Handler<never>>>();

  on<K extends GameEventName>(event: K, handler: Handler<K>): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => {
      set.delete(handler as Handler<never>);
    };
  }

  once<K extends GameEventName>(event: K, handler: Handler<K>): Unsubscribe {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  emit<K extends GameEventName>(event: K, payload: GameEventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    for (const handler of [...set]) {
      try {
        (handler as Handler<K>)(payload);
      } catch (error) {
        // Ein fehlerhafter Zuhoerer darf die uebrigen nicht blockieren.
        console.error(`[EventBus] handler for "${String(event)}" failed`, error);
      }
    }
  }

  /** Anzahl registrierter Handler — nur fuer Tests und Leak-Diagnose. */
  listenerCount(event: GameEventName): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
