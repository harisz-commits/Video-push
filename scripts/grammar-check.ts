import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ScriptDraft, draftSceneToScene, type DraftScene } from "../lib/schema";

/**
 * Guards the two limits structured outputs enforces on a schema, both of which
 * this project has already tripped over in production:
 *
 *   - "The compiled grammar is too large" — caused by a discriminated union
 *   - "too many optional parameters (limit: 24)" — caused by flattening it
 *
 * Run with `npm run verify:grammar` before changing lib/schema.ts.
 */
const OPTIONAL_LIMIT = 24;

const fmt = zodOutputFormat(ScriptDraft) as unknown as { schema: unknown };
const schema = fmt.schema as Record<string, unknown>;
const json = JSON.stringify(schema);

/** Every property the API would count as optional, anywhere in the schema. */
function countOptional(node: unknown, path = "", found: string[] = []): string[] {
  if (!node || typeof node !== "object") return found;

  const obj = node as Record<string, unknown>;
  const props = obj.properties as Record<string, unknown> | undefined;

  if (props) {
    const required = new Set((obj.required as string[] | undefined) ?? []);
    for (const name of Object.keys(props)) {
      if (!required.has(name)) found.push(path ? `${path}.${name}` : name);
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    if (key === "required") continue;
    const next = key === "properties" ? path : path;
    if (Array.isArray(value)) {
      value.forEach((v) => countOptional(v, next, found));
    } else if (value && typeof value === "object") {
      const childPath =
        props && key in props ? (path ? `${path}.${key}` : key) : next;
      countOptional(value, childPath, found);
    }
  }
  return found;
}

const optional = countOptional(schema);
const anyOf = (json.match(/"anyOf"/g) ?? []).length;

console.log(`JSON-Schema:          ${json.length} Zeichen`);
console.log(`anyOf-Vorkommen:      ${anyOf}`);
console.log(`optionale Parameter:  ${optional.length} (Limit ${OPTIONAL_LIMIT})`);
console.log(`  ${optional.join(", ")}`);

const drafts: DraftScene[] = [
  { type: "hook", anchorPhrase: "a", headline: "H", phase: "crisis", kicker: "K" },
  {
    type: "counter",
    anchorPhrase: "a",
    headline: "H",
    phase: "crisis",
    values: [{ label: "2005", value: 14.5, suffix: "Mio." }],
  },
  {
    type: "iconGrid",
    anchorPhrase: "a",
    headline: "H",
    phase: "crisis",
    icon: "barn",
    total: 40,
    remaining: 25,
  },
  {
    type: "mapFlow",
    anchorPhrase: "a",
    headline: "H",
    phase: "crisis",
    region: "europe",
    flows: [{ from: "X", to: "Y" }],
  },
  {
    type: "chain",
    anchorPhrase: "a",
    headline: "H",
    phase: "crisis",
    nodes: [
      { icon: "flame", label: "Gas" },
      { icon: "wheat", label: "Ernte" },
    ],
    breakAt: 0,
  },
  {
    type: "split",
    anchorPhrase: "a",
    headline: "H",
    phase: "crisis",
    panels: [
      { icon: "barn", label: "L" },
      { icon: "wheat", label: "R" },
    ],
  },
  {
    type: "chart",
    anchorPhrase: "a",
    headline: "H",
    phase: "crisis",
    variant: "line",
    series: [1, 2],
    labels: ["a", "b"],
  },
  {
    type: "pillars",
    anchorPhrase: "a",
    headline: "H",
    phase: "solution",
    pillars: ["A", "B"],
    unstableIndex: 0,
    carries: "C",
  },
  {
    type: "closer",
    anchorPhrase: "a",
    headline: "H",
    phase: "solution",
    statement: "S",
  },
];

let converted = 0;
for (const draft of drafts) {
  if (draftSceneToScene(draft, "s01")) converted++;
  else console.log(`  UMWANDLUNG FEHLGESCHLAGEN: ${draft.type}`);
}
console.log(`Umwandlung:           ${converted}/9 Typen ergeben eine strenge Scene`);

const incomplete = draftSceneToScene(
  { type: "counter", anchorPhrase: "a", headline: "H", phase: "crisis" },
  "s01",
);
console.log(
  `unvollständig:        ${incomplete === null ? "korrekt abgelehnt" : "FEHLER: durchgelassen"}`,
);

const failures =
  (optional.length > OPTIONAL_LIMIT ? 1 : 0) +
  (converted < 9 ? 1 : 0) +
  (incomplete === null ? 0 : 1);

if (failures > 0) {
  console.error("\nPrüfung fehlgeschlagen.");
  process.exit(1);
}
console.log("\nAlles im Rahmen.");
