# Last Stand: Zombie Front — Umsetzungsplan

> Master-Spezifikation: siehe Briefing (Masterprompt). Dieses Dokument ist die
> technische Übersetzung davon: Architektur, Datenmodelle, Reihenfolge, Risiken,
> Annahmen. Es wird pro Phase fortgeschrieben.

Stand: Phase 1 abgeschlossen. Phasen 2–9 offen.

---

## 1. Verortung im Repository

Das Spiel liegt als **eigenständiges Subprojekt** unter
`games/last-stand-zombie-front/` mit eigener `package.json`, eigenem Vite-Setup
und eigenem TypeScript-Config.

Begründung: Das Wurzel-Repository ist eine Next.js/Remotion-Anwendung
(`infographics-studio`). Das Spiel darf keine Runtime-, Build- oder
Dependency-Kopplung dorthin haben — YouTube Playables verlangt ein autarkes
Bundle. Getrennte Toolchains sind hier die einfachste Garantie dafür.

---

## 2. Architekturüberblick

Vier Schichten, Abhängigkeiten zeigen ausschließlich nach unten:

```
┌─────────────────────────────────────────────────────────┐
│  scenes/         BootScene · LoadingScene · MenuScene    │  Präsentation
│  ui/             RunScene · ResultsScene · HUD           │
├─────────────────────────────────────────────────────────┤
│  run/  army/  enemies/  combat/  progression/            │  Spiellogik
│  (RunDirector, ArmyManager, CombatSystem, MetaProgression)│
├─────────────────────────────────────────────────────────┤
│  core/           GameState · EventBus · Types · Config   │  Kern
│  config/         gameBalance · unitTiers · … (Daten)     │
├─────────────────────────────────────────────────────────┤
│  platform/  save/  audio/  ads/                          │  Infrastruktur
│  (PlatformService-Abstraktion, SaveManager, AudioManager)│
└─────────────────────────────────────────────────────────┘
```

### Feste Regeln

1. **Kein Gameplay-Code kennt YouTube.** Alles läuft über `PlatformService`.
   Ein `grep -r "playables\|ytgame" src/ --exclude-dir=platform` muss leer sein.
2. **Simulation ist von Rendering getrennt.** `ArmyManager`, `CombatSystem`,
   `RunDirector` sind reine TypeScript-Logik ohne Babylon-Import und damit ohne
   Browser headless testbar. Nur `*Renderer`- und `scenes/`-Dateien importieren
   `@babylonjs/core`.
3. **Keine Magic Numbers in Systemen.** Zahlen leben in `src/config/*.ts`.
4. **Kommunikation über `EventBus`**, nicht über direkte Querverweise zwischen
   Systemen. Szenen abonnieren, Systeme publizieren.
5. **Fixed-Step-Simulation** (60 Hz), Rendering interpoliert nicht — bei
   Framedrops wird die Simulation gebündelt nachgezogen (max. 5 Steps/Frame),
   damit Balancing framerate-unabhängig bleibt.

### Modulgrenzen (wer darf wen importieren)

| Modul | darf importieren |
|---|---|
| `core/`, `config/` | nichts aus dem Projekt (außer `core/Types`) |
| `platform/`, `save/` | `core/` |
| `army/`, `enemies/`, `combat/`, `run/`, `progression/` | `core/`, `config/` |
| `army/SoldierRenderer`, `scenes/`, `ui/` | alles + Babylon |
| `app/` | alles |

---

## 3. Datenmodelle

### 3.1 Armee — Combat Power vs. Display Count

Das zentrale System. Drei getrennte Größen:

```ts
interface ArmyState {
  /** Mathematische Wahrheit. Immer in Tier-1-Basiseinheiten (Militia-Power). */
  combatPower: number;
  /** Index in UNIT_TIERS. Bestimmt Modell, Feuerkraft, Optik. */
  tierIndex: number;
  /** Nur Anzeige/Rendering. Abgeleitet, nie Quelle der Wahrheit. */
  displayCount: number;
  /** Rest-Fortschritt unterhalb einer vollen Einheit des aktuellen Tiers. */
  overflowProgress: number;
}
```

Ableitungsregeln (in `CombatPowerSystem`, rein funktional):

```
powerPerUnit(tier)      = tier.powerPerUnit          // aus config/unitTiers
rawUnits                = combatPower / powerPerUnit(currentTier)
displayCount            = clamp(floor(rawUnits), 1, DISPLAY_CAP_ALLIES)
overflowProgress        = rawUnits - floor(rawUnits)
```

**Promotion** (bei Checkpoint bzw. Promotion-Trigger):

```
Beispiel: 237 Militia, Tier 1 → Tier 2 (100 Militia = 1 Rifleman)
  combatPower bleibt 237            ← Power geht NIE verloren
  tierIndex   1 → 2
  displayCount = floor(237/100) = 2 Riflemen
  overflowProgress = 0.37           ← wird als Fortschrittsbalken gezeigt
```

Entscheidend: `combatPower` ist eine **invariante Größe** über Promotions
hinweg. Promotion ändert nur, *wie* diese Power dargestellt und mit welchen
Tier-Modifikatoren (Feuerrate, Durchschlag) sie im Kampf verrechnet wird.
Dadurch kann Restpower per Konstruktion nicht verschwinden.

Damit Promotion sich **stärker** anfühlt, obwohl die Köpfe weniger werden:
- Tier-Modifikatoren (`damageMultiplier`, `fireRateMultiplier`, `pierce`)
  greifen multiplikativ auf die Power.
- Sichtbar größere/markantere Modelle, andere Farbe, Mündungsfeuer-Skalierung.
- Promotion-Sequenz: kurzer Zeitlupen-Blitz, Sound, HUD-Tierwechsel.
- Direkt nach Promotion wächst `displayCount` wieder spürbar schnell an.

### 3.2 Zahlbereiche

`combatPower` wächst über Tiers exponentiell (100^n). Bei Tier 5 sind
Größenordnungen von 10^8+ realistisch, im Endlosmodus mehr. `number` (double,
2^53 exakt) trägt das bis ca. Tier 6–7 problemlos. **Annahme:** kein BigInt für
V1; ein `NumberFormat`-Helper (1.2K / 3.4M / 5.6B) übernimmt die Darstellung.
Wenn Endless jenseits 10^15 skaliert, wird auf eine Mantisse/Exponent-Struktur
umgestellt — die Kapselung in `CombatPowerSystem` macht das zu einer lokalen
Änderung.

### 3.3 Run

```ts
interface RunState {
  mode: 'campaign' | 'survival' | 'endless';
  sectorIndex: number;
  sectors: SectorPlan[];        // vorab generiert (campaign/survival)
  threatLevel: number;          // endless: steigt pro Sektor
  army: ArmyState;
  runModifiers: RunModifier[];  // Roguelite-Karten aus Checkpoints
  stats: RunStats;              // kills, bosses, sectors, peakTier …
}

interface SectorPlan {
  type: SectorType;             // gates | combat | hazard | elite | holdout | boss …
  lengthMeters: number;
  seed: number;                 // deterministische Generierung
  entries: SectorEntry[];       // Gates, Spawns, Hazards mit z-Position
}
```

Sektoren werden **deterministisch aus einem Seed** generiert. Damit ist ein Run
reproduzierbar (Debugging, Balancing, evtl. Replay-Verifikation) ohne
Replay-Daten zu speichern.

### 3.4 Savegame

```ts
interface SaveDataV1 {
  version: 1;
  meta: { coins: number; techParts: number; xp: number };
  upgrades: Record<string, number>;   // upgradeId → Level
  unlocks: string[];                  // Modi, Zonen, Tiers
  progress: { campaignSector: number; highestTier: number };
  stats: { runs: number; kills: number; bestScore: number; bestEndlessSector: number };
  settings: { audio: boolean; haptics: boolean };
  tutorialDone: boolean;
}
```

Versioniert, mit Migrationskette in `save/migrations/`. Unbekannte künftige
Versionen werden nicht "repariert", sondern führen zu einem sauberen Reset mit
Log-Warnung (verhindert korrupte Zustände).

---

## 4. Implementierungsreihenfolge

| Phase | Inhalt | Status |
|---|---|---|
| 1 | Setup, PlatformService, Szenen-Gerüst, Kamera + Lane-Prototyp | **fertig** |
| 2 | Auto-Vorwärtsbewegung, Lateral-Steuerung, Crowd-Instancing, erste Gates | offen |
| 3 | CombatPower, Tier-System, Promotion, Overflow, HUD-Anbindung | offen |
| 4 | Zombie-Archetypen, aggregiertes Kampfsystem, Hit-Feedback, Boss-Prototyp | offen |
| 5 | Sektoren, RunDirector, Supply Drops, Hazards, Checkpoints, Results | offen |
| 6 | Coins, UpgradeTree, Unlocks, Save/Load produktiv | offen |
| 7 | EndlessDirector, Threat-Eskalation, Score | offen |
| 8 | YouTubePlatformService real, Ads, Lifecycle, Score-Submit | offen |
| 9 | UI-Politur, Audio, VFX, Balancing, Performance, QA | offen |

Nach jeder Phase: Statusbericht, dann Freigabe abwarten.

---

## 5. Technische Risiken

| # | Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|---|
| R1 | **Crowd-Performance auf Mobile.** 120 Alliierte + 200 Zombies mit Animation | Framerate bricht ein | Thin Instances, keine Skelett-Animation für Masse (Positions-/Rotations-Wobble im Vertex-Shader oder simple Hüpf-Kurve), 1 Material pro Fraktion. Budget: ≤ 30 Draw Calls im Run. Ab Phase 2 mit echtem Zähler messen. |
| R2 | **Bundle-Größe.** Babylon-Vollimport ist mehrere MB | Ladezeit, evtl. Playables-Limit | Nur `@babylonjs/core` mit Side-Effect-Imports pro Feature, kein `babylonjs`-Metapaket, keine Inspector/Loaders im Prod-Build. Budget-Check im Validator. |
| R3 | **Playables-SDK-Verhalten unbekannt/änderbar** | Integration bricht spät | Vollständige Abstraktion ab Tag 1 + LocalPlatformService als Referenzimplementierung. Phase 8 tauscht nur eine Datei. |
| R4 | **Zahlen-Overflow bei Endless** | falsche Balance, NaN | Kapselung in `CombatPowerSystem`, Format-Helper, Unit-Tests auf Promotion-Invarianten. |
| R5 | **Promotion fühlt sich als Rückschritt an** | Kernmechanik verpufft | Design-Gegenmaßnahmen (s. 3.1) + Promotion nur an inszenierten Checkpoints, nie mitten im Kampf. Frühes Playtesting in Phase 3. |
| R6 | **Rundenlänge 2–5 min langweilt** | Retention | Sektortypen-Wechsel alle 25–40 s, Roguelite-Auswahl an Checkpoints. Kadenz wird in `config/sectors.ts` als Kurve gepflegt, nicht im Code. |
| R7 | **Determinismus vs. Framerate** | Balance framerate-abhängig | Fixed-Step-Simulation (Punkt 2, Regel 5), seeded PRNG statt `Math.random()` in der Generierung. |
| R8 | **Audio-State von YouTube** | Ton spielt trotz Mute | Sämtliche Wiedergabe über `AudioManager`, der `platform.isAudioEnabled()` prüft und auf Änderungen hört. |
| R9 | **Asset-Pipeline.** Externe Assets sind verboten | Compliance-Verstoß | Alle Assets in `public/assets/`, Validator prüft den Build auf absolute/externe URLs. Phase 1 nutzt reine Prozedural-Geometrie. |

---

## 6. Offene Annahmen (bitte bestätigen oder korrigieren)

1. **A1 — Ort im Repo.** Subprojekt unter `games/last-stand-zombie-front/`
   statt Wurzel, um die bestehende Next.js-App nicht zu berühren.
2. **A2 — Grafik.** V1 arbeitet mit prozeduraler Box-/Kapsel-Geometrie und
   Vertex-Farben statt eingekaufter Modelle. Sieht bewusst „stylized clean" aus
   und hält das Bundle klein. Echte Modelle können später eingehängt werden,
   die Renderer-Schnittstelle bleibt gleich.
3. **A3 — Portrait-first.** Zielauflösung 1080×1920, Landscape wird unterstützt,
   aber nicht optimiert.
4. **A4 — Sprache.** UI-Texte über eine kleine `strings`-Map, Default Englisch
   (Playables-Publikum ist international), `platform.getLanguage()` wird
   ausgewertet. Code-Kommentare/Doku auf Deutsch.
5. **A5 — Keine echten Playables-SDK-Aufrufe vor Phase 8.** Der
   `YouTubePlatformService` existiert bereits, ist aber gegen ein *angenommenes*
   SDK-Interface geschrieben und muss in Phase 8 gegen die reale Doku
   verifiziert werden. Er ist so gebaut, dass fehlende SDK-Methoden sauber auf
   No-Op/Fallback laufen statt zu werfen.
6. **A6 — Kein BigInt in V1** (siehe 3.2).
7. **A7 — Tests.** Vitest für die reine Logik (Power/Promotion/Save/Generierung).
   Kein Rendering-Test, kein E2E in V1.

---

## 7. Was Phase 1 konkret liefert

- Vite + TypeScript + `@babylonjs/core`, Strict Mode, Build ohne Warnungen.
- `PlatformService`-Interface, `LocalPlatformService` (localStorage, gemockte
  Ads/Score/Lifecycle), `YouTubePlatformService` (vorbereitet, Feature-Detection).
- `EventBus`, `GameState`, `Types`, `Config`, erste `config/*`-Dateien inkl.
  vollständiger Tier-Tabelle.
- Szenen-Maschine: Boot → Loading → Menu → Run → Results, mit sauberem
  Auf-/Abbau je Szene.
- Run-Prototyp: Kamera (erhöht, portrait-tauglich), scrollende Lane, Marker,
  Fixed-Step-Loop, Input-Handling (Drag/Maus/Tastatur) — noch ohne Armee.
- `SaveManager` mit Schema v1 + Migrationsgerüst.
- `youtube:validate`-Skript: prüft Build auf externe URLs, absolute Pfade,
  `index.html` im Root, Bundle-Größe. `youtube:build` erzeugt das ZIP.
- Vitest-Setup mit ersten Tests (Save-Roundtrip, EventBus, Config-Integrität).

### Gemessene Ergebnisse

| Kennzahl | Wert | Bewertung |
|---|---|---|
| Draw Calls im Run | **6** | Budget ≤ 30. Instancing trägt. |
| Meshes in der Szene | 137 (6 Master + Instanzen) | wie erwartet |
| Bundle (JS) | 1,60 MB roh · **381 kB gzip** | fast vollständig Babylon; s. R2 |
| Bundle gesamt (ZIP) | ~376 kB | unkritisch |
| Tests | 38 grün | — |
| Externe Requests im Durchlauf | **0** | über Playwright-Route mitgeschnitten |

Framerate wurde nur unter SwiftShader (Software-Rendering im Container)
gemessen und ist deshalb nicht aussagekräftig; die Frame-Zeit von ~1 ms zeigt
aber, dass die Szene nicht GPU-gebunden ist. Eine Messung auf echter Hardware
gehört an den Anfang von Phase 2.

### Abweichungen von der ursprünglichen Struktur

- Statt eines Wurzel-`assets/`-Ordners liegen Assets unter `src/assets/` und
  werden **importiert** statt per URL geladen. Nur so garantiert der Bundler,
  dass nichts extern nachgeladen wird.
- `scenes/playfield/` (RunCamera, TrackScenery, SquadMarker) kam hinzu: das
  ist Darstellung und gehört damit weder nach `run/` (Logik) noch direkt in
  die Szene.
- `util/` (Random, math, format) kam hinzu — gemeinsame Helfer ohne
  Spiellogik.

### Was Phase 1 bewusst NICHT enthält

Keine Armee, keine Gates, keine Gegner, kein Kampf, keine Sektoren, kein
Endlosmodus, keine Meta-Upgrades, kein Audio. Der Ergebnisbildschirm zeigt
Platzhalterwerte, und die Runde endet nur über den Knopf „End run".
