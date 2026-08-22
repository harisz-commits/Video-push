/**
 * English is the fallback locale and therefore the key master: every other
 * locale is type-checked against this object's shape.
 */
export const en = {
  'app.title': 'Merge Factory',
  'app.subtitle': 'Junkyard Empire',

  'loading.title': 'Loading',
  'loading.save': 'Restoring your factory',

  'hud.coins': 'Coins',
  'hud.rank': 'Rank',

  'board.full': 'Board full',
  'board.sell': 'Sell',
  'board.storage': 'Storage',

  'generator.tap': 'Tap to create scrap',

  'orders.title': 'Orders',
  'orders.deliver': 'Deliver',
  'orders.reward': '+{coins} coins',
  'orders.need': 'Need {count}× {item}',

  'tutorial.merge': 'Drag to merge',
  'tutorial.generator': 'Tap to create scrap',
  'tutorial.orders': 'Complete orders',
  'tutorial.done': "You're ready. Build your factory.",
  'tutorial.skip': 'Skip',

  'state.paused': 'Paused',
} as const;

export type TranslationKey = keyof typeof en;
export type TranslationTable = Record<TranslationKey, string>;
