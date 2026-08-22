/**
 * Working title lives here and nowhere else (briefing §1: the name must be
 * easy to swap). UI reads these through the localization layer where the text
 * is player-facing; this file holds the identity itself.
 */
export const BRANDING = {
  gameId: 'merge-factory',
  title: 'Merge Factory',
  subtitle: 'Junkyard Empire',
  get fullTitle(): string {
    return `${this.title}: ${this.subtitle}`;
  },
} as const;
