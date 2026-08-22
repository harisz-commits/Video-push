# Merge Factory: Junkyard Empire — Plan

> Arbeitstitel. Der Projektname steht an genau einer Stelle im Code
> (`src/config/branding.ts`) und wird von überall referenziert — Umbenennen ist
> eine Ein-Zeilen-Änderung.

## 0. Warum ein Unterordner

Dieses Repository beherbergt bereits ein unabhängiges Projekt
(`Infographics Studio`, Next.js + Remotion) im Root. Das Spiel ist ein
komplett eigenständiges Vite/Phaser-Artefakt mit eigenen Dependencies,
eigenem Build und eigenem Test-Runner. Es lebt darum vollständig unter
`games/merge-factory/` mit eigener `package.json`. Root-Build und
Root-Tests bleiben unangetastet.

---

## 1. Analyse des Briefings

### Was das Spiel im Kern ist

Ein 5×6-Merge-Board mit Generator, Aufträgen und zwei Meta-Ebenen
(Factory Rank, Prestige). Die eigentliche Schleife ist sehr kurz:

```
Tap Generator → Item spawnt → Drag auf gleiches Item → Merge → Level+1
      ↑                                                        │
      └──────────── Order erfüllen → Coins → Upgrade ──────────┘
```

Alles andere (Ranks, Prestige, Booster, Ads) hängt an dieser Schleife.
Die Schleife muss deshalb zuerst perfekt sein — deswegen die Phasen.

### Nicht verhandelbare Randbedingungen

| Bedingung | Konsequenz für die Architektur |
|---|---|
| Kein externer Traffic im Prod-Build | Alle Assets prozedural/inline, Validator im Build |
| YouTube-SDK-Aufrufe nirgends im Gameplay | `PlatformService`-Interface, Gameplay kennt nur das Interface |
| `loadData()` muss vor dem ersten `saveData()` fertig sein | Save-Gate im `SaveManager`, `LOADING_SAVE` als eigener State |
| YouTube-Mute hat Vorrang vor eigenem Regler | `AudioManager` berechnet effektive Lautstärke aus beidem |
| `firstFrameReady()` / `gameReady()` genau einmal | Idempotenz im Adapter, nicht beim Aufrufer |
| Kein Crash bei Ad-/SDK-Fehlern | Jeder SDK-Call gekapselt, gibt neutralen Wert zurück statt zu werfen |
| Board darf nie unlösbar sein | Sell + Storage-Slots sind immer da; Rewarded Rescue ist nur ein Extra |

### Was das Briefing bewusst offen lässt

Konkrete Balancing-Zahlen, Item-Namen, Rank-Schwellen. Diese gehören
ausnahmslos in `src/config/*` bzw. `economyConfig.ts` und nie in
Gameplay-Code.

---

## 2. Zielarchitektur

### Schichten

```
┌─────────────────────────────────────────────────────────┐
│ Scenes (Boot, Loading, Game, UI-Overlays)               │  Phaser
├─────────────────────────────────────────────────────────┤
│ Gameplay: Board · MergeManager · Orders · Economy ·      │  reines TS,
│           Progression · Boosters                        │  Phaser-frei
├─────────────────────────────────────────────────────────┤
│ Services: Save · Audio · Ads · Localization             │
├─────────────────────────────────────────────────────────┤
│ PlatformService  (Interface)                            │
│   ├── LocalPlatformService     (localStorage, Mock-Ads) │
│   ├── YouTubePlatformService   (ytgame.*)               │
│   └── PlaygamaPlatformService  (später, gleiches API)   │
└─────────────────────────────────────────────────────────┘
```

**Regel:** Pfeile zeigen nur nach unten. Die Gameplay-Schicht importiert
niemals `ytgame`, niemals `window`, niemals `localStorage`. Sie ist damit
auch ohne Browser testbar (Vitest, Node-Umgebung).

### Warum die Gameplay-Schicht Phaser-frei bleibt

Merge-Regeln, Order-Generierung und Economy sind reine Datenlogik. Hält
man sie frei von Phaser, laufen die in Abschnitt 37 geforderten Tests
ohne Canvas, ohne WebGL und ohne jsdom — in Millisekunden. Phaser-Code
beschränkt sich auf Darstellung und Eingabe.

### Zustands-Maschine

```
BOOT → LOADING → LOADING_SAVE → TUTORIAL ⇄ PLAYING → PRESTIGE_CONFIRM
                                    │  ▲       │
                                    ▼  │       ▼
                                  PAUSED    AD_PENDING
```

Ein einziger `GameStateMachine` mit expliziter Übergangstabelle. Ein
verbotener Übergang ist ein Programmierfehler und wirft im Dev-Build.

### Geplante Dateistruktur

```
games/merge-factory/
  PLAN.md                       ← dieses Dokument
  README.md
  ASSET_SOURCES.md
  THIRD_PARTY_LICENSES.md
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  index.html                    ← YouTube-SDK-Tag vor dem Bundle
  public/                       (leer im MVP — Assets werden gebundled)
  scripts/
    validate-youtube-build.ts   ← npm run youtube:validate
    create-youtube-zip.ts       ← npm run youtube:zip
    scan-forbidden-urls.ts      ← von Validator + CI genutzt
  src/
    main.ts                     ← Einstiegspunkt, wählt Platform-Adapter
    game/
      Game.ts                   ← Phaser-Config, Scale-Manager
      GameContext.ts            ← Dependency-Container (kein Singleton-Wildwuchs)
      GameStateMachine.ts
    scenes/
      BootScene.ts
      LoadingScene.ts           ← ruft firstFrameReady()
      GameScene.ts              ← ruft gameReady()
    board/
      Board.ts  Cell.ts  MergeItem.ts  MergeManager.ts
    orders/
      Order.ts  OrderManager.ts  OrderGenerator.ts
    economy/
      EconomyManager.ts  economyConfig.ts
    progression/
      ProgressionManager.ts  prestigeConfig.ts
    boosters/
      BoosterManager.ts
    ads/
      AdManager.ts  adConfig.ts
    platform/
      PlatformService.ts        ← Interface + Typen
      LocalPlatformService.ts
      YouTubePlatformService.ts
      detectPlatform.ts
      ytgame.d.ts               ← Typen für das YouTube-SDK
    save/
      SaveManager.ts  saveSchema.ts
      migrations/index.ts
    audio/
      AudioManager.ts  sfx.ts   ← WebAudio-generierte Sounds, keine Dateien
    localization/
      LocalizationManager.ts
      translations/en.ts  de.ts  …
    render/
      itemTextures.ts           ← prozedurale Item-Grafiken
    ui/
      components/
    config/
      branding.ts  items.ts  progression.ts  gameBalance.ts
  tests/
    merge.test.ts  save.test.ts  orders.test.ts
    economy.test.ts  ads.test.ts  platform.test.ts
```

---

## 3. Technische Risiken

Nach Schwere sortiert. Jedes Risiko hat eine konkrete Gegenmaßnahme, die
in der genannten Phase umgesetzt wird.

### R1 — Save-Race: speichern bevor `loadData()` fertig ist  ·  *kritisch*
Ein Autosave, der vor dem geladenen Save feuert, überschreibt den
Spielstand mit einem leeren Board. Das ist der teuerste denkbare Bug.
**Gegenmaßnahme:** `SaveManager` startet im Zustand `sealed`. Jeder
`save()` vor dem Abschluss von `load()` wird verworfen und geloggt, nicht
gepuffert. Entsiegelt wird ausschließlich im Übergang
`LOADING_SAVE → TUTORIAL/PLAYING`. Test deckt genau diesen Fall ab.
*(Phase 5, Gate bereits in Phase 1 vorbereitet)*

### R2 — Board-Deadlock  ·  *kritisch*
Volles Board ohne mögliches Merge-Paar und ohne Coins zum Verkaufen.
**Gegenmaßnahme:** Verkaufen kostet nie etwas und ist immer verfügbar;
zwei Storage-Slots existieren ab Spielstart. Rewarded Rescue ist additiv.
Ein Test prüft, dass aus jedem vollen Board ein Zug existiert.
*(Phase 2 Grundlage, Phase 3 UI)*

### R3 — YouTube-SDK nicht ladbar / andere API-Form  ·  *hoch*
Das SDK wird per `<script>` von YouTube geladen. Ist es nicht da, darf
das Spiel nicht hängen.
**Gegenmaßnahme:** `detectPlatform()` prüft `ytgame?.IN_PLAYABLES_ENV`
defensiv mit `typeof`, mit Timeout, und fällt sonst auf
`LocalPlatformService` zurück. Jeder einzelne SDK-Aufruf liegt in
try/catch und liefert einen definierten Fallback statt zu werfen.
*(Phase 1)*

### R4 — Externer Traffic schleicht sich ein  *(Ablehnung im Review)*  ·  *hoch*
Eine Google-Font, ein CDN-Icon, ein vergessener `fetch` — und die
Einreichung fällt durch.
**Gegenmaßnahme:** Keine Assetdateien. Item-Grafiken werden zur Laufzeit
prozedural gezeichnet, Sounds per WebAudio synthetisiert, Schrift ist ein
System-Font-Stack. Dazu ein Scanner, der Source *und* `dist` nach
`http(s)://`, `//cdn`, `fetch(`, `XMLHttpRequest`, `WebSocket` durchsucht
und nur `https://www.youtube.com/game_api/v1` erlaubt.
*(Phase 1 Scanner, durchgehend erzwungen)*

### R5 — Responsive: Portrait *und* Landscape ohne Abschneiden  ·  *hoch*
Ein 5×6-Grid ist hochkant; im Querformat bleibt wenig Höhe.
**Gegenmaßnahme:** Kein `Phaser.Scale.FIT` auf feste Canvas-Größe,
sondern `RESIZE` mit eigenem Layout-Solver: Zellgröße =
`min(verfügbareBreite/5, verfügbareHöhe/6)`, Rest wird als Padding
verteilt; in Landscape wandern Orders und Generator seitlich neben das
Grid statt darüber/darunter. Safe-Area-Insets via `env(safe-area-inset-*)`.
*(Phase 1 Gerüst, Phase 2 Feinschliff)*

### R6 — Pause/Resume unvollständig  ·  *mittel*
Ein weiterlaufender Tween oder Timer während der Pause verbraucht Akku
und kann Zustände desynchronisieren.
**Gegenmaßnahme:** Pause geht durch genau einen Pfad
(`GameContext.pause()`), der Scene, Tweens, Timer, Input und Audio
gemeinsam anhält und einen Save auslöst. Keine `visibilitychange`-Nutzung
als Ersatz. *(Phase 5)*

### R7 — Save-Größe wächst unbemerkt  ·  *mittel*
**Gegenmaßnahme:** Kompaktes Schema (Board als flaches Int-Array, keine
Objektschlüssel pro Zelle), plus ein Test, der einen Worst-Case-Spielstand
serialisiert und gegen ein Budget von 16 KB prüft — weit unter dem Limit.
*(Phase 5)*

### R8 — Interstitial zur falschen Zeit  ·  *mittel*
Ein Interstitial mitten im Drag zerstört die Session.
**Gegenmaßnahme:** `AdManager.requestInterstitial()` prüft eine Liste von
Eligibility-Regeln (Tutorial aktiv, Session < N Sekunden, Cooldown, Drag
aktiv, Rewarded gerade gelaufen) und wird ausschließlich an definierten
Breakpoints aufgerufen. Frequenz komplett in `adConfig.ts`.
*(Phase 6)*

### R9 — Phaser-Bundle-Größe  ·  *niedrig*
Phaser 3 liegt minifiziert bei ~1,2 MB, gzip ~300 KB. Das Budget von
< 5 MB ist damit gut haltbar, solange keine Bilddateien dazukommen — was
durch R4 ohnehin ausgeschlossen ist. Der Validator prüft die Größe hart.
*(Phase 8)*

### R10 — `sendScore` zu häufig  ·  *niedrig*
**Gegenmaßnahme:** Nur bei neuem Highscore, debounced, ganzzahlig.
*(Phase 5)*

---

## 4. YouTube-Kompatibilität — Prüfliste

| Anforderung | Umsetzung | Phase |
|---|---|---|
| SDK vor Game-Bundle in `index.html` | statisches `<script src="https://www.youtube.com/game_api/v1">` als erstes Element in `<head>`, Bundle als `type="module"` am Ende von `<body>` | 1 |
| Erkennung via `ytgame.IN_PLAYABLES_ENV` | `detectPlatform()` | 1 |
| `firstFrameReady()` einmal | Adapter-intern per Flag, aufgerufen aus `LoadingScene` nach dem ersten gerenderten Frame | 1 |
| `gameReady()` einmal | aus `GameScene`, erst nach Save-Load + Board-Render + Input aktiv | 1/5 |
| `loadData()` vor `saveData()` | Save-Gate (R1) | 1/5 |
| `sendScore()` nur Integer, debounced | `ProgressionManager` | 5 |
| `getLanguage()` als einzige Sprachquelle | `LocalizationManager`, Fallback `en` | 5 |
| Audio-State respektieren + abonnieren | `AudioManager` | 5 |
| Pause/Resume abonnieren | `GameContext` | 5 |
| Fehler via SDK-Health melden | `logError` / `logWarning` im Adapter | 1 |
| kein Exit/Link/Share/Login/Newsletter | UI-Review, im Validator als Textscan | 7/8 |
| relative Pfade | `base: './'` in `vite.config.ts` + Validator | 1 |
| ZIP ohne `dist/`-Ebene | `create-youtube-zip.ts` schreibt Einträge relativ zu `dist` | 8 |

**Bewusst nicht implementiert:** Pre-Roll (verwaltet YouTube selbst,
Abschnitt 17).

---

## 5. Phasen und Abnahmekriterien

| Phase | Inhalt | Abnahme |
|---|---|---|
| **1** | Projektgerüst, Phaser-Setup, responsives Canvas, PlatformService + beide Adapter, State Machine, Save-Gate, URL-Scanner | Build läuft, Tests grün, Canvas passt sich in Portrait/Landscape an, Local-Adapter funktioniert ohne YouTube |
| 2 | Grid, Items, Drag & Drop, Merge, Generator | Spielschleife macht Spaß |
| 3 | Orders, Coins, Generator-Upgrades | Balancing prüfbar |
| 4 | Factory XP, Ranks, Prestige | sichtbarer Langzeitfortschritt |
| 5 | Save/Load, volle SDK-Integration, Pause, Audio, i18n | Spielstand übersteht Reload und Pause |
| 6 | Rewarded + Interstitial Ads, AdManager | Ad-Fehler ändern das Spiel nicht |
| 7 | Tutorial, Animationen, Partikel, Polish | erste 60 Sekunden sitzen |
| 8 | Tests, Performance, Validator, ZIP | `youtube:build` erzeugt eine abgabefähige ZIP |

Nach jeder Phase: Build, Tests, README-Update, Commit. **Diese Runde endet
nach Phase 1.**

---

## 6. Phase-1-Lieferumfang im Detail

1. `package.json`, `tsconfig.json`, `vite.config.ts` (`base: './'`),
   `vitest.config.ts`
2. `index.html` mit YouTube-SDK vor dem Bundle, Safe-Area-CSS, kein
   Scrollbalken
3. `PlatformService`-Interface mit allen 14 geforderten Methoden
4. `LocalPlatformService` — localStorage, Mock-Ads (konfigurierbar
   erfolgreich/fehlschlagend), Browsersprache, simulierte Pause/Resume
5. `YouTubePlatformService` — jeder Aufruf in try/catch, `firstFrameReady`
   und `gameReady` idempotent, Save-Gate
6. `detectPlatform()` mit Fallback auf Local
7. `GameStateMachine` mit expliziter Übergangstabelle
8. `Game.ts` + `BootScene` + `LoadingScene` + leere `GameScene`, responsives
   Layout mit quadratischen Zellen (Grid noch ohne Interaktion)
9. `LocalizationManager` mit `en`/`de` und Fallback
10. `scripts/scan-forbidden-urls.ts` + `npm run youtube:validate` (erste
    Ausbaustufe)
11. Tests für Platform-Adapter, State Machine, Save-Gate, Localization
12. `README.md`, `ASSET_SOURCES.md`, `THIRD_PARTY_LICENSES.md`

**Ausdrücklich noch nicht in Phase 1:** Merge-Logik, Drag & Drop, Orders,
Economy, Ads, Tutorial, ZIP-Build.
