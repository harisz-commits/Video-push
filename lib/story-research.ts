import Anthropic from "@anthropic-ai/sdk";
import { LlmError } from "./llm";
import type { TextModel } from "./text-models";

/**
 * Looking the facts up before writing anything.
 *
 * The gap this closes was structural rather than subtle. The video format ran
 * style, outline, sections - and nowhere in any of those three prompts is
 * there a single fact. A ten-minute film about World of Warcraft Classic was
 * written entirely from the model's memory, which produces prose that reads
 * fluently and says almost nothing: patch numbers, launch dates, queue lengths
 * and raid names are exactly what a model blurs. The complaint that a script
 * was "Müll" was a complaint about that, and no larger model fixes it - a
 * better writer with no facts writes more eloquent filler.
 *
 * The infographics format has had this since it existed, in lib/pipeline.ts,
 * and the video format simply never got it. This is that idea rebuilt for two
 * providers instead of one, because the writing model is now a choice and the
 * research has to follow it: asking Anthropic to research for a Gemini script
 * would make an Anthropic key mandatory for everyone.
 *
 * Both branches obey the same contract: a deadline they will not exceed, and a
 * partial answer rather than none. A short sheet of checked facts beats a long
 * one that was invented, and beats a killed function entirely.
 */

export type Research = {
  /** One fact per line, "- FAKT | QUELLE". Empty when nothing was found. */
  facts: string;
  /** How many web searches actually happened. Zero means nothing was checked. */
  searches: number;
  usage: { input: number; output: number };
};

/** How many facts a film of this length is worth. */
function factsWanted(minutes: number): number {
  return Math.max(10, Math.min(40, Math.round(minutes * 2.5)));
}

const systemPrompt = (wanted: number) => `Du bist Faktenrechercheur für ein deutsches Erklärvideo. Du suchst im Web und lieferst eine Faktenliste, sonst nichts.

Antworte ausschließlich mit Zeilen in diesem Format:
- FAKT | QUELLE

VORGABEN:
- Ungefähr ${wanted} Fakten.
- Jeder Fakt, der eine Zahl, ein Datum oder einen Eigennamen enthält, MUSS aus
  einem Suchergebnis stammen. Schreib nichts aus dem Gedächtnis.
- Nenne die Jahreszahl, wo es eine gibt. Nicht "vor ein paar Jahren".
- QUELLE ist der Name der Seite oder Organisation, von der der Fakt stammt.
- Kannst du eine Zahl nicht belegen, lass den Fakt weg. Eine kurze Liste
  belegter Fakten ist besser als eine lange mit erfundenen.
- Such nach dem, woraus sich erzählen lässt: konkrete Ereignisse mit Ort und
  Datum, Zahlen mit Bezugsgröße, Namen von Beteiligten, Entscheidungen und
  ihre Folgen, Wendepunkte. Keine allgemeinen Einordnungen — die kann das
  Modell später selbst.
- Verteil die Fakten über das ganze Thema, nicht alle auf einen Aspekt.
- GELDBETRÄGE: Steht in einem Fakt eine historische Geldsumme, such die
  heutige Kaufkraft mit und schreib sie in denselben Fakt, mit Bezugsjahr:
  "2 Millionen Reichsmark (1923), heute rund 8 Millionen Euro". Findest du
  keine Umrechnung, nimm stattdessen eine Vergleichsgröße aus derselben Zeit,
  die jeder kennt — was ein Arbeiter im Jahr verdiente, was ein Brot kostete.
  Eine nackte alte Zahl ohne Maßstab ist für dieses Video wertlos.
- MAßSTÄBE: Dasselbe gilt für große Zahlen, die keine Geldsummen sind. Wenn du
  eine Fläche, ein Gewicht oder eine Menge findest, such nach einer
  Bezugsgröße dazu — wieviele Fußballfelder, wieviele Jahresproduktionen,
  wieviel pro Kopf.
- SUCHBUDGET: begrenzt. Such gezielt statt breit.
- SIND DIE SUCHEN AUFGEBRAUCHT: schreib die Liste aus dem, was du hast. Brich
  niemals ab und entschuldige dich nicht. Ein aufgebrauchtes Budget ist das
  erwartete Ende der Recherche, kein Fehler.
- Kein einleitender Satz, keine Erklärung, kein Schlusswort.`;

const userPrompt = (topic: string, minutes: number) =>
  `Thema: ${topic}

Recherchiere die Fakten für ein ${minutes}-minütiges Erklärvideo dazu.
Suche im Web. Antworte nur mit der Faktenliste.`;

/** Keep only lines that look like facts, so prose around them cannot leak in. */
function factLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-") && line.includes("|"))
    .map((line) => line.slice(0, 400));
}

export async function researchTopic(args: {
  topic: string;
  minutes: number;
  model: TextModel;
  apiKey: string;
  /** Epoch time to stop by, whatever has been found. */
  deadline: number;
}): Promise<Research> {
  return args.model.provider === "google" ? viaGoogle(args) : viaAnthropic(args);
}

/** How many search rounds either provider gets. */
const MAX_SEARCHES = 6;
/** How many times an Anthropic turn paused by its search loop is resumed. */
const MAX_RESUMES = 3;

async function viaAnthropic(args: {
  topic: string;
  minutes: number;
  model: TextModel;
  apiKey: string;
  deadline: number;
}): Promise<Research> {
  const client = new Anthropic({ apiKey: args.apiKey, maxRetries: 0 });
  const wanted = factsWanted(args.minutes);
  const facts: string[] = [];
  const usage = { input: 0, output: 0 };
  let searches = 0;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt(args.topic, args.minutes) },
  ];

  for (let round = 0; round <= MAX_RESUMES; round++) {
    if (Date.now() > args.deadline) break;

    const message = await client.messages.create(
      {
        model: args.model.id,
        max_tokens: 4000,
        // Searching and summarising is not the same work as writing, and the
        // deep setting is what once made a research call run five minutes.
        ...(args.model.supportsEffort === false
          ? {}
          : { output_config: { effort: "low" as const } }),
        system: systemPrompt(wanted),
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES },
        ],
        messages,
      },
      // The deadline only helps between turns; one search turn can block for
      // minutes on its own, so the request itself gets a hard cap.
      { timeout: Math.max(15_000, args.deadline - Date.now()), maxRetries: 0 },
    );

    usage.input += message.usage.input_tokens;
    usage.output += message.usage.output_tokens;
    searches += message.content.filter(
      (b) => b.type === "server_tool_use" && b.name === "web_search",
    ).length;

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    facts.push(...factLines(text));

    // The server-side search loop hit its iteration limit mid-turn. Sending
    // the assistant turn straight back resumes it; no extra user message.
    // Anything found this turn is kept first, so a later turn that runs out of
    // budget cannot take the earlier findings down with it.
    if (message.stop_reason === "pause_turn" && Date.now() < args.deadline) {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    break;
  }

  return { facts: dedupe(facts).join("\n"), searches, usage };
}

const GOOGLE_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";

async function viaGoogle(args: {
  topic: string;
  minutes: number;
  model: TextModel;
  apiKey: string;
  deadline: number;
}): Promise<Research> {
  const wanted = factsWanted(args.minutes);
  const ids = [args.model.id, ...(args.model.alt ?? [])];
  let lastError: LlmError | null = null;

  for (const id of ids) {
    try {
      return await ask(id);
    } catch (err) {
      if (!(err instanceof LlmError) || err.status !== 404) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new LlmError(`Kein Modell unter ${ids.join(", ")}.`, 404);

  async function ask(modelId: string): Promise<Research> {
    const response = await fetch(
      `${GOOGLE_ENDPOINT}/${encodeURIComponent(modelId)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": args.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt(wanted) }] },
          contents: [
            {
              role: "user",
              parts: [{ text: userPrompt(args.topic, args.minutes) }],
            },
          ],
          // Grounding with Google Search. Deliberately no responseMimeType
          // here, unlike every other call in this studio: the search tool and
          // forced JSON output do not combine, and the answer is plain lines
          // anyway.
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 4000 },
        }),
        signal: AbortSignal.timeout(Math.max(15_000, args.deadline - Date.now())),
      },
    );

    const raw = await response.text().catch(() => "");
    if (!response.ok) {
      throw new LlmError(
        `Google (${modelId}) antwortete auf die Recherche mit ${response.status}.`,
        response.status,
      );
    }

    let body: {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        groundingMetadata?: { webSearchQueries?: string[] };
      }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
    };
    try {
      body = JSON.parse(raw);
    } catch {
      throw new LlmError("Google antwortete nicht mit JSON.", 502);
    }

    const candidate = body.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");

    return {
      facts: dedupe(factLines(text)).join("\n"),
      // What Google actually searched for, which is the only honest count -
      // an empty list means the model answered from memory after all.
      searches: candidate?.groundingMetadata?.webSearchQueries?.length ?? 0,
      usage: {
        input: body.usageMetadata?.promptTokenCount ?? 0,
        output:
          (body.usageMetadata?.candidatesTokenCount ?? 0) +
          (body.usageMetadata?.thoughtsTokenCount ?? 0),
      },
    };
  }
}

/** Resumed turns repeat what they already said; the same fact twice is noise. */
function dedupe(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const id = line.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(line);
  }
  return out;
}
