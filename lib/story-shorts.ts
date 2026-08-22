import { complete } from "./llm";
import { shortSeconds, StoryShort, type StoryProject } from "./story";
import type { TextModel } from "./text-models";

/**
 * Choosing which sixty seconds of a film can stand alone.
 *
 * The only part of a short that needs a model at all. Everything else already
 * exists — the pictures, the recording, the sound, the cut — so this is a
 * question of selection, not of production: which stretch of an eight-minute
 * documentary makes sense to somebody who has seen none of it.
 *
 * The model gets the shots with their real durations, measured from the
 * recording, so it can count seconds instead of guessing at them. That is why
 * this runs after the film has a voice and not before.
 */

export const SHORT_TARGET_SECONDS = 60;
/** How many are proposed. Five, and they must not be five cuts of one scene. */
export const SHORTS_PER_FILM = 5;

const SYSTEM_PROMPT = `Du schneidest Shorts aus einem fertigen deutschen Erklärvideo.

Du bekommst die Einstellungen des Videos, durchnummeriert, mit ihrer Dauer in
Sekunden. Du wählst Ausschnitte, die für sich allein funktionieren.

WAS EINEN AUSSCHNITT TRÄGT:
- EIN abgeschlossener Gedanke. Kein Anriss, keine halbe Erklärung.
- Etwas Konkretes: eine Zahl, ein Ereignis, ein Gegenstand, eine Folge. Ein
  Ausschnitt, der nur Stimmung transportiert, ist verschenkt.
- Er beginnt an einer Stelle, an der man ohne Vorwissen einsteigen kann, und
  hört auf, bevor der nächste Gedanke anfängt.
- Er endet nicht mitten im Satz und nicht mit einem Verweis auf etwas, das im
  Video vorher kam ("wie wir gesehen haben", "deshalb").

DIE LÄNGE:
- Zusammen ungefähr ${SHORT_TARGET_SECONDS} Sekunden, gerechnet aus den
  angegebenen Dauern. Zwischen 40 und 62 Sekunden ist in Ordnung.
- Rechne nach, bevor du antwortest. Die Dauern stehen dabei.

DIE FÜNF MÜSSEN VERSCHIEDEN SEIN:
- Aus verschiedenen Teilen des Videos, ohne Überschneidung.
- Sie dürfen nicht dieselbe Sache zweimal erzählen. Wer alle fünf sieht, soll
  fünf Dinge gelernt haben.

DER HOOK:
- Ein einziger Satz, der VOR dem Ausschnitt gesprochen wird. Er ist neu und
  steht so nicht im Video.
- Er nennt, worum es gleich geht, und macht neugierig — ohne die Antwort schon
  zu geben und ohne zu übertreiben. Keine Frage an den Zuschauer, kein
  "Wusstest du", kein "Das wirst du nicht glauben".
- Höchstens 14 Wörter. Er wird gesprochen UND groß eingeblendet.
- Er muss zum ersten Satz des Ausschnitts passen, als hätte man es so
  geschrieben.

DER TITEL:
- Höchstens 60 Zeichen, für den Upload. Sagt, was drin ist.

Antworte mit einem JSON-Objekt, sonst nichts:
{"shorts":[{"from":12,"to":31,"hook":"…","title":"…"}]}

- "from" und "to" sind Einstellungsnummern, beide einschließlich.`;

function buildPrompt(args: {
  project: StoryProject;
  durations: number[];
}): string {
  const lines = args.project.shots
    .map((shot, i) => `${i}\t${args.durations[i].toFixed(1)}s\t${shot.text}`)
    .join("\n");

  const total = args.durations.reduce((a, b) => a + b, 0);
  const facts = args.project.research?.trim()
    ? `\n\nBELEGTE FAKTEN des Videos, als Hilfe beim Erkennen des Konkreten:\n${args.project.research.trim()}`
    : "";

  return `Video: „${args.project.title}"
Thema: ${args.project.topic}
Länge: ${Math.round(total)} Sekunden in ${args.project.shots.length} Einstellungen${facts}

DIE EINSTELLUNGEN (Nummer, Dauer, gesprochener Text):
${lines}

Wähl ${SHORTS_PER_FILM} Ausschnitte.`;
}

export type ShortPlan = { from: number; to: number; hook: string; title: string };

export async function proposeShorts(args: {
  project: StoryProject;
  model: TextModel;
  apiKey: string;
}): Promise<{ shorts: ShortPlan[]; usage: { input: number; output: number } }> {
  const durations = args.project.shots.map((_, i) =>
    shortSeconds(args.project, i, i),
  );

  const reply = await complete({
    model: args.model,
    apiKey: args.apiKey,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildPrompt({ project: args.project, durations }) },
    ],
    maxTokens: 4000,
    effort: "medium",
  });

  const start = reply.text.indexOf("{");
  const end = reply.text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Die Antwort enthielt kein JSON-Objekt.");
  }
  const json = JSON.parse(reply.text.slice(start, end + 1)) as {
    shorts?: unknown;
  };

  const last = args.project.shots.length - 1;
  const taken: [number, number][] = [];
  const shorts: ShortPlan[] = [];

  for (const item of Array.isArray(json.shorts) ? json.shorts : []) {
    const s = item as {
      from?: unknown;
      to?: unknown;
      hook?: unknown;
      title?: unknown;
    };
    const from = Math.max(0, Math.min(last, Math.round(Number(s.from))));
    const to = Math.max(from, Math.min(last, Math.round(Number(s.to))));
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;

    const hook = typeof s.hook === "string" ? s.hook.trim() : "";
    if (hook.length < 4) continue;

    // Overlaps are dropped rather than trimmed. Two shorts sharing a stretch
    // means the same thing is said twice to the same feed, which is exactly
    // what "die fünf müssen verschieden sein" was asking for — and a trimmed
    // overlap would leave one of them starting mid-thought.
    if (taken.some(([a, b]) => from <= b && to >= a)) continue;
    taken.push([from, to]);

    const title = typeof s.title === "string" ? s.title.trim() : "";
    shorts.push({
      from,
      to,
      hook: hook.slice(0, 220),
      title: (title || args.project.title).slice(0, 100),
    });
  }

  if (shorts.length === 0) {
    throw new Error("Das Modell hat keine brauchbaren Ausschnitte gewählt.");
  }

  return { shorts: shorts.slice(0, SHORTS_PER_FILM), usage: reply.usage };
}

/** What a proposal turns into once the hooks have been recorded. */
export function toShort(plan: ShortPlan, index: number): StoryShort {
  return StoryShort.parse({
    id: `s${index + 1}-${plan.from}-${plan.to}`,
    title: plan.title,
    hook: plan.hook,
    from: plan.from,
    to: plan.to,
  });
}
