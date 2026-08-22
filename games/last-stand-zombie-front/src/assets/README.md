# Assets

Assets werden **importiert**, nicht per URL geladen — nur so landen sie
gehasht im Bundle und es entsteht garantiert kein externer Request
(YouTube-Playables-Anforderung).

```ts
import shotUrl from '../assets/audio/shot.wav';
```

Ablage:

- `models/`   – Geometrie (Phase 9; bis dahin ist alles prozedural)
- `textures/` – Texturen
- `audio/`    – Soundeffekte und Musik
- `ui/`       – Icons

Kleine Dateien (< 8 kB) inlined Vite automatisch als Data-URI, grosse
bekommen eine relative URL unter `assets/`.
