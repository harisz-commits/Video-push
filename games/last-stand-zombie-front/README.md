# Last Stand: Zombie Front

HTML5/WebGL Crowd-Action-Game für **YouTube Playables**.
BabylonJS · TypeScript · Vite · kein Backend, keine externen Laufzeit-Requests.

> **Status: Phase 1 abgeschlossen.** Es gibt eine lauffähige Grundstruktur mit
> Menü, Run-Prototyp (Steuerung + Kamera + scrollende Strecke) und
> Ergebnisbildschirm. Armee, Gates, Gegner und Progression folgen ab Phase 2.
> Der vollständige Plan steht in [`PLAN.md`](./PLAN.md).

## Schnellstart

```bash
npm install
npm run dev          # http://localhost:5173
```

Steuerung: **links/rechts ziehen** (Maus oder Touch), alternativ Pfeiltasten
bzw. `A`/`D`.
Im lokalen Modus zusätzlich: `F9` Pause umschalten, `F10` Ton umschalten,
`?debug=1` blendet FPS/Draw-Calls ein.

## Skripte

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver mit Hot Reload |
| `npm run build` | Typecheck + Produktionsbundle nach `dist/` |
| `npm run preview` | Produktionsbundle lokal servieren |
| `npm run typecheck` | Nur TypeScript prüfen |
| `npm test` | Logik-Tests (Vitest) |
| `npm run youtube:validate` | `dist/` gegen die Playables-Regeln prüfen |
| `npm run youtube:build` | Build + Validierung + ZIP nach `dist-zip/` |

`scripts/smoke.mjs` ist ein manueller Browser-Durchlauf (Menü → Run → Ergebnis)
und verlangt ein separat installiertes Playwright — bewusst keine
Projektabhängigkeit. Aufruf steht im Kopf der Datei.

## Architektur in einem Absatz

Vier Schichten mit Abhängigkeiten ausschließlich nach unten: Szenen/UI über
Spiellogik über Kern/Konfiguration über Infrastruktur. Zwei Regeln tragen den
Rest:

1. **Kein Gameplay-Code kennt YouTube.** Speichern, Werbung, Score, Lifecycle
   und Audiostatus laufen über `PlatformService`; es gibt eine lokale und eine
   YouTube-Implementierung, und getauscht wird genau eine Datei.
2. **Simulation ist von Rendering getrennt.** Alles unter `army/`, `combat/`,
   `run/` und `progression/` ist reines TypeScript ohne Babylon-Import und
   damit ohne Browser testbar. Nur `scenes/`, `ui/` und `*Renderer` sehen
   Babylon.

Balancingzahlen stehen in `src/config/` — nicht im Code verteilt.

## YouTube-Playables-Konformität

`npm run youtube:validate` prüft das gebaute Bundle auf externe URLs,
absolute Pfade, `index.html` im Root und die Bundle-Größe. Bekannte, von
keinem erreichbaren Codepfad gelesene Babylon-Standardwerte (KTX2-Decoder,
EXR-Loader, Snippet-Server) sind einzeln und exakt freigegeben; jede andere
externe URL lässt den Build fehlschlagen.

## Verhältnis zum übrigen Repository

Dieses Verzeichnis ist ein eigenständiges Projekt mit eigener Toolchain. Es
teilt keine Abhängigkeiten mit der Next.js/Remotion-Anwendung im
Wurzelverzeichnis — ein Playable muss autark sein.
