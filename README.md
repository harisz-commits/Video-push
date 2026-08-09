# Infographics Studio

Stichwort rein, fertiges MP4 raus. Claude schreibt Skript und Szenenliste,
ElevenLabs spricht es mit Zeichen-Timestamps, Remotion rendert daraus ein
1920×1080-Erklärvideo im Flat-Vector-Infografik-Stil.

Der Kern ist eine Regel: **keine Szenendauer wird jemals von Hand gesetzt.**
Jede Szene trägt eine `anchorPhrase`, die wörtlich im Voiceover vorkommt.
ElevenLabs liefert für jedes Zeichen dieses Voiceovers eine Startzeit — damit
wird aus „wo beginnt diese Szene" eine Textsuche. Ändert sich das Skript,
ändert sich das Timing automatisch mit.

---

## Ablauf

```
Stichwort
   │  POST /api/script      Claude (claude-sonnet-4-6, Structured Outputs)
   ▼
VideoProject (JSON)         Voiceover + 10–14 Szenen mit anchorPhrase
   │  POST /api/voice       ElevenLabs /with-timestamps
   ▼
+ audioUrl + alignment      MP3 in Vercel Blob, Zeichen-Timestamps im Projekt
   │  resolveSceneTimings() lib/align.ts — Phrase → Zeichenindex → Frame
   ▼
Live-Vorschau               @remotion/player, kein Render nötig
   │  POST /api/render      Vercel Sandbox
   ▼
MP4 in Vercel Blob
```

## Aufbau

| Pfad | Rolle |
|---|---|
| `lib/schema.ts` | Zod-Schema und Types. Der Vertrag zwischen allen Teilen. |
| `lib/align.ts` | Anker-Phrasen → Szenenzeiten. Das Herz der Automatisierung. |
| `lib/prompt.ts` | System-Prompt für den Scriptwriter. |
| `lib/elevenlabs.ts` | TTS-Client mit Timestamps. |
| `lib/guardrails.ts` | Rate-Limit und hartes Tagesbudget. |
| `lib/store.ts` | Kleine JSON- und Binärdokumente in Vercel Blob. |
| `proxy.ts` | Passwortsperre vor der gesamten App. |
| `remotion/Video.tsx` | Mapper: JSON → Szenenfolge. |
| `remotion/scenes/*` | Die neun Szenentypen. |
| `remotion/shared/*` | Tokens, Motion, Icons, SceneShell, Caption. |
| `components/*` | Studio-UI inklusive Timeline mit Wellenform. |
| `data/europa.json` | Seed-Datensatz, 781 Wörter, 13 Szenen. |

### Warum die Szenen wiederverwendbar sind

Ein Szenentyp ist eine React-Komponente plus ein Zweig im Zod-Schema. Ein neues
Video ist ein neuer JSON-Datensatz — kein neues Bauprojekt. Die neun Typen
decken die Muster ab, die Erklärvideos brauchen: Behauptung (`hook`),
Zahlenvergleich (`counter`), Schwund (`iconGrid`), Warenströme (`mapFlow`),
Ursachenkette (`chain`), Gegenüberstellung (`split`), Zeitverlauf (`chart`),
tragende Faktoren (`pillars`), Schluss (`closer`).

---

## Einen neuen Szenentyp hinzufügen

Fünf Schritte, alle typgeprüft — der `switch` in `Video.tsx` hat einen
`never`-Guard, es kompiliert also erst wieder, wenn die Verdrahtung steht.

**1. Schema-Zweig in `lib/schema.ts`.** Einmal in `Scene` (mit `sceneBase`) und
einmal in `ScriptDraft` (mit `draftBase`):

```ts
z.object({
  ...sceneBase,
  type: z.literal("timeline"),
  events: z.array(z.object({ year: z.string(), label: z.string() })).min(2),
}),
```

**2. Komponente in `remotion/scenes/Timeline.tsx`.** Sie bekommt
`{ scene, frame, accent }` und rendert *innerhalb* der Safe Area; Hintergrund,
Raster und Untertitel liefert die `SceneShell` bereits:

```tsx
type TimelineScene = Extract<Scene, { type: "timeline" }>;

export const Timeline: React.FC<SceneRenderProps<TimelineScene>> = ({
  scene, frame, accent,
}) => {
  const { fps } = useVideoConfig();
  return <div>{scene.events.map((e, i) => (
    <div key={i} style={{ opacity: drive(frame, fps, i * T.stagger) }}>{e.label}</div>
  ))}</div>;
};
```

Halte dich an `drive()` aus `shared/motion.ts` und an `TYPE`/`C` aus
`shared/Tokens.ts` — nur so bleibt die Bewegung im ganzen Film dieselbe.

**3. Zweig in `remotion/Video.tsx`:**

```tsx
case "timeline":
  return <Timeline scene={s} frame={frame} accent={accent} />;
```

**4. Probe-Komposition in `remotion/Root.tsx`** (Eintrag in `SCENE_PROBES`).
Danach lässt sich die Szene einzeln in Remotion Studio öffnen und scrubben.

**5. Prompt in `lib/prompt.ts` ergänzen**, damit Claude weiß, wann der Typ
sinnvoll ist — ein Satz unter „SZENEN", z. B. *„Chronologie von Ereignissen
→ timeline"*.

Optional: eine Zeile in `summarize()` in `components/SceneInspector.tsx`, damit
der Detailbereich die Daten der Szene zusammenfasst.

### Ein neues Icon hinzufügen

Alle Icons stehen in `remotion/shared/icons/index.tsx`. Regeln, die den
gemeinsamen Look tragen: 48×48-Viewbox, Geometrie innerhalb von 4 px Rand,
2 px Strichstärke, runde Enden, flächige Füllung als `currentColor` mit
niedriger Deckkraft, keine Verläufe, keine Schatten, keine zweite Farbe. Namen
zusätzlich in `ICON_NAMES` in `lib/schema.ts` eintragen — das Enum begrenzt
gleichzeitig, was Claude auswählen darf.

---

## Lokal starten

```bash
npm install
cp .env.example .env.local     # Keys eintragen
npm run dev                    # Studio auf http://localhost:3000
npm run remotion               # Remotion Studio, alle Szenen einzeln
npm run verify:timing          # Anker → Frames gegen den Seed prüfen
```

Ohne `ANTHROPIC_API_KEY` und `ELEVENLABS_API_KEY` startet die App trotzdem und
zeigt den Europa-Seed — nur „Skript erzeugen" und „Generieren" antworten dann
mit einer Fehlermeldung.

## Deploy

Reihenfolge zählt: das Vercel-Projekt muss existieren, bevor der Blob-Store
angehängt werden kann.

1. Repo auf GitHub pushen, auf **vercel.com** importieren, einmal deployen.
2. **Storage → Create Database → Blob**, dem Projekt zuweisen.
   `BLOB_READ_WRITE_TOKEN` steht danach automatisch bereit.
3. Env-Variablen setzen (siehe `.env.example`), vor allem `STUDIO_PASSWORD`.
4. **Neu deployen.** Erst jetzt läuft `create-snapshot` durch — es braucht den
   Blob-Token und legt den Sandbox-Snapshot an, aus dem jeder Render bootet.
5. Lokal nachziehen: `vercel link && vercel env pull .env.local`.

Der Build ist `next build && npm run create-snapshot` (siehe `vercel.json`).
Ohne den Snapshot-Schritt würde der erste Render jedes Deployments Chromium
installieren und das Remotion-Bundle bauen — Minuten statt Sekunden.

---

## Guardrails

Jeder Aufruf von `/api/script`, `/api/voice` und `/api/render` kostet echtes
Geld. Vier Schichten liegen davor:

**1. Passwort vor der ganzen App.** `proxy.ts` — die Datei hieß vor Next.js 16
`middleware.ts` — mit HTTP Basic über
`STUDIO_PASSWORD` (Benutzername beliebig). Das ist die äußerste Kostensperre —
wer nicht durchkommt, kann nichts auslösen. Nicht gesetzt = offen, also in
Produktion immer setzen. Alternativ Vercel Password Protection.

**2. Rate-Limit pro Route.** Gleitendes Fenster im Speicher der Instanz:
6/min Skript, 4/min Stimme, 2/min Render.

**3. Hartes Tagesbudget.** In Vercel Blob gezählt, gilt über alle Instanzen:

| Variable | Standard |
|---|---|
| `DAILY_SCRIPT_LIMIT` | 40 |
| `DAILY_VOICE_LIMIT` | 20 |
| `DAILY_RENDER_LIMIT` | 10 |

`0` schaltet die jeweilige Route komplett ab. Das Kontingent wird **vor** dem
teuren Aufruf reserviert, nicht danach — ein Lauf, der auf halber Strecke
abbricht, hat die Tokens trotzdem verbraucht. Der Zähler ist ein
Read-Modify-Write; zwei exakt gleichzeitige Anfragen können sich theoretisch
einen Zählschritt teilen. Für ein Single-Operator-Studio hinter Passwort ist
das der bewusste Tausch gegen eine zusätzliche Datenbank — es ist eine
Budgetgrenze, kein Abrechnungsjournal.

**4. Vercel Spend Management.** Nicht im Code abbildbar, unbedingt einschalten:
**Vercel → Settings → Billing → Spend Management**, Betrag setzen und
„Pause Production Deployments" aktivieren. Das ist die einzige Sperre, die auch
greift, wenn etwas außerhalb dieser App entgleist.

**Blob-Cleanup.** `/api/cron/cleanup` läuft nächtlich um 04:00 (siehe
`vercel.json`) und löscht alles unter `renders/` und `audio/`, das älter als
`BLOB_MAX_AGE_DAYS` (Standard 30) ist. `snapshot-cache/` ist bewusst
ausgenommen — dessen Löschung würde das Rendern bis zum nächsten Deploy
lahmlegen. Geschützt über `CRON_SECRET`, das Vercel automatisch setzt.

### Was Geld kostet

| Posten | Größenordnung pro Video |
|---|---|
| Claude, ein Skript | ~4k Input-, ~6k Output-Tokens |
| ElevenLabs | ~5.300 Zeichen |
| Vercel Sandbox | ein 1080p-Render von ~5 Minuten Laufzeit |
| Vercel Blob | ~5 MB MP3 + MP4 |

Der Render ist mit Abstand der teuerste Posten. Deshalb ist `/api/render`
gesperrt, solange kein Audio existiert: ein Render ohne Tonspur wäre ein
stummes Video auf geschätzter Zeitachse — die teuerste Art, das herauszufinden.

---

## Entscheidungen, die vom Brief abweichen

- **Structured Outputs statt „antworte nur mit JSON".** `/api/script` nutzt
  `output_config.format` mit dem Zod-Schema. Das Format ist damit erzwungen
  statt erbeten; die Prosa-Anweisung „kein Markdown, keine Backticks" wäre
  totes Gewicht in jedem Request. Assistant-Prefills, die man dafür früher
  gebraucht hätte, liefern auf `claude-sonnet-4-6` ohnehin einen 400er.
- **Fonts self-hosted statt `@remotion/google-fonts`.** „Archivo Expanded" ist
  keine eigene Google-Fonts-Familie und liegt deshalb nicht in dem Paket — es
  ist die variable Archivo bei `wdth 125`. Genau diese Instanz liegt als woff2
  unter `public/fonts/`, zusammen mit Inter Tight und JetBrains Mono. Der
  Renderer hängt damit an keinem Netzabruf mitten im Render.
- **`phase` als Szenenfeld.** Der Navy→Mint-Wechsel hängt an
  `phase: "crisis" | "solution"` statt an „ab Szene 10". So landet der
  Farbumschlag dort, wo das Skript tatsächlich dreht.
- **Europa als Regionen-Set.** Eine einzelne vereinfachte Küstenlinie ist von
  Hand kaum wiedererkennbar zu bekommen. `mapFlow` zeichnet den Kontinent als
  Blöcke (Iberien, Frankreich, Britische Inseln, Skandinavien, Stiefel …) —
  lesbarer und stilistisch konsequenter.
- **Szene 11 des Seeds** nutzt `iconGrid` mit `satellite`, weil `iconGrid` per
  Definition ein Icon führt; die drei Hebel stehen in `sub`.

## Bekannte Grenzen

- **Voiceover-Länge.** `eleven_multilingual_v2` nimmt 10.000 Zeichen pro
  Request. 750–850 Wörter Deutsch sind ~5.300 — also eine Anfrage, kein
  Zusammensetzen von MP3s. Längere Texte lehnt `/api/voice` mit klarer Meldung
  ab, statt sie stumm abzuschneiden (das würde jede Szene danach desynchronisieren).
- **Render-Laufzeit.** `/api/render` hält die Function offen, solange die
  Sandbox rendert (`maxDuration = 300`). Auf Vercel Hobby liegt die Obergrenze
  darunter; lange Renders brechen dort ab.
- **Fortschritt über Blob.** `/api/progress` liest ein JSON aus dem Blob-Store,
  weil eine Folgeanfrage auf einer anderen Instanz landen kann. Die minimale
  Cache-Zeit dort ist 60 Sekunden, deshalb hängt der Leser einen
  Cache-Buster an die URL.
