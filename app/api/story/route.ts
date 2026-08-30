import { waitUntil } from "@vercel/functions";
import { errorResponse, guard } from "../../../lib/guardrails";
import { keyFor, keyNameFor } from "../../../lib/llm";
import {
  DEFAULT_STORY_MODEL,
  generateStory,
  importStoryScript,
} from "../../../lib/story-pipeline";
import { noteCharacterUse } from "../../../lib/characters";
import { noteLookUse, readLooks } from "../../../lib/looks";
import { slugify } from "../../../lib/image-library";
import { StoryPerspective, StoryStyle } from "../../../lib/story";
import { resolveTextModel, type TextModel } from "../../../lib/text-models";
import {
  readJson,
  storyJobPath,
  writeJson,
  type StoryJob,
} from "../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Write a video: the script and the picture list, nothing drawn.
 *
 * The split from drawing is the whole design. This costs well under a cent and
 * takes under a minute; drawing the same film costs dollars and takes many.
 * Producing the cheap half first means a script that comes back wrong can be
 * thrown away for nothing, which is the only way a format this expensive is
 * usable at all.
 */
export async function POST(req: Request) {
  let topic: string;
  let script: string | undefined;
  let minutes: number;
  let imageBudget: number;
  let imagesPerMinute: number | undefined;
  let styleWish: string | undefined;
  let lookId: string | undefined;
  let characters: { key: string; name: string; description: string }[];
  let research: boolean;
  let perspective: StoryPerspective;
  let model: TextModel;
  try {
    const body = (await req.json()) as {
      topic?: unknown;
      script?: unknown;
      minutes?: unknown;
      imageBudget?: unknown;
      imagesPerMinute?: unknown;
      styleWish?: unknown;
      lookId?: unknown;
      characters?: unknown;
      research?: unknown;
      perspective?: unknown;
      model?: unknown;
    };
    // Ein eingefügtes Skript ersetzt das Thema: dann wird nichts geschrieben,
    // sondern nur bebildert. Siehe importStoryScript().
    script =
      typeof body.script === "string" && body.script.trim().length > 40
        ? body.script.trim().slice(0, 60_000)
        : undefined;
    if (
      !script &&
      (typeof body.topic !== "string" || body.topic.trim().length < 3)
    ) {
      throw new Error("topic");
    }
    // Long, because the topic here is a briefing rather than a subject line —
    // "Ägypter und wie sie die Hitze überlebt haben, bitte viel über Baustoffe".
    topic =
      typeof body.topic === "string" ? body.topic.trim().slice(0, 2000) : "";

    // Twenty-five is the stated ceiling. It is not yet the renderable ceiling:
    // a restored sandbox lives five minutes and cannot be extended, so a film
    // beyond roughly six minutes has to be rendered in sections. The script
    // itself is fine at any length in this range, so the limit stays here and
    // the render route is what will have to grow.
    minutes = Math.min(25, Math.max(1, Number(body.minutes) || 5));

    // The money knob. Every picture beyond this is one the writer has to do
    // without by making a motif come back instead.
    imageBudget = Math.min(400, Math.max(4, Number(body.imageBudget) || 60));

    // Only carried through so the studio can say what the film was built to.
    // The budget above is what actually binds the writer.
    imagesPerMinute =
      Number.isFinite(Number(body.imagesPerMinute)) &&
      Number(body.imagesPerMinute) > 0
        ? Math.min(20, Math.max(0.5, Number(body.imagesPerMinute)))
        : undefined;

    styleWish =
      typeof body.styleWish === "string" && body.styleWish.trim()
        ? body.styleWish.trim().slice(0, 600)
        : undefined;

    lookId =
      typeof body.lookId === "string" &&
      /^[a-zA-Z0-9_-]{4,64}$/.test(body.lookId)
        ? body.lookId
        : undefined;

    // Read from the request rather than looked up by key alone, because a
    // figure may be typed in for one film and never saved. The saved ones are
    // sent the same way — the library is a convenience for the person, not a
    // second source of truth for the server.
    characters = (Array.isArray(body.characters) ? body.characters : [])
      .slice(0, 6)
      .map(
        (item) =>
          item as { key?: unknown; name?: unknown; description?: unknown },
      )
      .map((c) => {
        const name =
          typeof c.name === "string" ? c.name.trim().slice(0, 80) : "";
        const description =
          typeof c.description === "string"
            ? c.description.trim().slice(0, 600)
            : "";
        return {
          key: slugify(typeof c.key === "string" && c.key ? c.key : name),
          name: name || "Figur",
          description,
        };
      })
      .filter((c) => c.description.length >= 3);

    // On unless switched off. The default matters: a script written without a
    // single checked fact is the failure that looks like success, so somebody
    // who never touches this switch should get the researched version.
    research = body.research !== false;

    // Anything unknown falls back to the explainer, which is the safe reading
    // of a missing field: it works for every topic, where "du bist dabei"
    // only works for a topic with people in it.
    perspective =
      StoryPerspective.safeParse(body.perspective).data ?? "erklaerung";

    model = resolveTextModel(
      typeof body.model === "string" ? body.model : DEFAULT_STORY_MODEL,
    );
  } catch {
    return errorResponse(
      "Ungültige Anfrage. Erwartet wird { topic: string, minutes?: number, imageBudget?: number }.",
      400,
    );
  }

  const apiKey = keyFor(model);
  if (!apiKey) {
    return errorResponse(
      `${keyNameFor(model)} ist nicht gesetzt — ${model.label} lässt sich ohne diesen Key nicht aufrufen.`,
      500,
    );
  }

  const allowed = await guard(req, "script", 4);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const jobId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  await writeJson(storyJobPath(jobId), {
    jobId,
    topic,
    status: "running",
    startedAt,
    updatedAt: startedAt,
  } satisfies StoryJob);

  // A kept look is fetched here rather than trusted from the request: the
  // style is what every image prompt is built from, and a caller that could
  // post one could make this account draw a hundred pictures to any
  // instruction it liked.
  const look = lookId
    ? (await readLooks().catch(() => null))?.looks.find((l) => l.id === lookId)
    : undefined;
  const style = look ? StoryStyle.safeParse(look.style) : undefined;

  if (script) {
    waitUntil(
      (async () => {
        await importStoryScript({
          jobId,
          script,
          style: style?.success ? style.data : undefined,
          styleWish: lookId ? undefined : styleWish,
          characters,
          imagesPerMinute,
          apiKey,
          model,
          startedAt,
        });
        if (look) await noteLookUse(look.id).catch(() => undefined);
        await noteCharacterUse(characters.map((c) => c.key)).catch(
          () => undefined,
        );
      })(),
    );
    return Response.json({ jobId });
  }

  waitUntil(
    (async () => {
      await generateStory({
        jobId,
        topic,
        minutes,
        imageBudget,
        imagesPerMinute,
        styleWish,
        style: style?.success ? style.data : undefined,
        characters,
        research,
        perspective,
        apiKey,
        model,
        startedAt,
      });
      // Counted after the fact and never awaited by the caller: these are for
      // showing what earns its keep, and a failure here must not cost a film.
      if (look) await noteLookUse(look.id).catch(() => undefined);
      await noteCharacterUse(characters.map((c) => c.key)).catch(
        () => undefined,
      );
    })(),
  );

  return Response.json({ jobId });
}

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
    return errorResponse("Ungültige oder fehlende jobId.", 400);
  }

  const job = await readJson<StoryJob>(storyJobPath(jobId));
  if (!job) return errorResponse("Zu dieser jobId gibt es kein Video.", 404);

  if (
    job.status === "running" &&
    Date.now() - job.startedAt > (maxDuration + 30) * 1000
  ) {
    return Response.json({
      ...job,
      status: "error",
      error:
        "Die Erzeugung hat das Zeitlimit überschritten. Versuch es erneut.",
    } satisfies StoryJob);
  }

  return Response.json(job);
}
