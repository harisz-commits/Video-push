import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ScriptDraft, draftSceneToScene, type DraftScene } from "../lib/schema";

const fmt = zodOutputFormat(ScriptDraft) as unknown as { schema: unknown };
const json = JSON.stringify(fmt.schema);
console.log("JSON-Schema-Größe:", json.length, "Zeichen");
console.log("anyOf-Vorkommen:", (json.match(/anyOf/g) ?? []).length);

// Umwandlung flach -> streng, für jeden der neun Typen
const drafts: DraftScene[] = [
  { type: "hook", anchorPhrase: "a", headline: "H", kicker: "K" },
  { type: "counter", anchorPhrase: "a", values: [{ label: "2005", value: 14.5, suffix: "Mio." }] },
  { type: "iconGrid", anchorPhrase: "a", icon: "barn", total: 40, remaining: 25 },
  { type: "mapFlow", anchorPhrase: "a", region: "europe", flows: [{ from: "X", to: "Y" }] },
  { type: "chain", anchorPhrase: "a", nodes: [{ icon: "flame", label: "Gas" }, { icon: "wheat", label: "Ernte" }], breakAt: 0 },
  { type: "split", anchorPhrase: "a", left: { icon: "barn", label: "L" }, right: { icon: "wheat", label: "R" } },
  { type: "chart", anchorPhrase: "a", variant: "line", series: [1, 2], labels: ["a", "b"] },
  { type: "pillars", anchorPhrase: "a", pillars: ["A", "B"], unstableIndex: 0, carries: "C" },
  { type: "closer", anchorPhrase: "a", statement: "S" },
];
let ok = 0;
for (const d of drafts) {
  const scene = draftSceneToScene(d, "s01");
  if (scene) ok++; else console.log("  FEHLGESCHLAGEN:", d.type);
}
console.log(`Umwandlung: ${ok}/9 Typen ergeben eine gültige strenge Scene`);

// Unvollstaendiger Entwurf muss abgelehnt werden, nicht geraten
const broken = draftSceneToScene({ type: "counter", anchorPhrase: "a" }, "s01");
console.log("counter ohne values ->", broken === null ? "null (korrekt abgelehnt)" : "FEHLER: durchgelassen");
