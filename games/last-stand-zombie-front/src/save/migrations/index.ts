/**
 * Migrationskette. Jede Funktion hebt einen Spielstand von Version `n`
 * auf `n + 1`. Es gibt aktuell nur Version 1, daher ist die Kette leer —
 * das Geruest steht aber, damit spaetere Schemaaenderungen keinen Umbau
 * erzwingen.
 *
 * Ein Spielstand aus der ZUKUNFT (hoehere Version als bekannt) wird nicht
 * "repariert": das wuerde stillschweigend Daten zerstoeren. Er wird in
 * `SaveManager` als unlesbar behandelt.
 */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // Version 0 = Spielstand ohne Versionsfeld (defekt oder aus einem
  // Vor-Release). Es gibt nichts umzubauen; `normalizeSave` fuellt fehlende
  // Felder danach mit Defaults auf.
  0: (data) => ({ ...data, version: 1 }),
  // 1: (data) => ({ ...data, version: 2, neuesFeld: true }),
};

/** Hebt `data` schrittweise auf `targetVersion`. */
export function migrate(
  data: Record<string, unknown>,
  fromVersion: number,
  targetVersion: number,
): Record<string, unknown> {
  let current = data;
  for (let version = fromVersion; version < targetVersion; version += 1) {
    const step = MIGRATIONS[version];
    if (!step) {
      throw new Error(`Missing save migration from version ${version}`);
    }
    current = step(current);
  }
  return current;
}
