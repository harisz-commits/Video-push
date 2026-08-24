/**
 * JSON aus einer Modellantwort holen, ohne am ersten Fehlzeichen aufzugeben.
 *
 * Vier Formate waren an vier Stellen mit derselben Zeile beschäftigt —
 * `indexOf("{")` bis `lastIndexOf("}")`, dann JSON.parse — und die hat drei
 * Schwächen, die alle schon zugeschlagen haben:
 *
 * - Steht vor dem Objekt Fließtext mit einer geschweiften Klammer darin,
 *   beginnt der Ausschnitt an der falschen Stelle.
 * - Wird die Antwort am Token-Limit abgeschnitten, ist alles verloren statt
 *   des angefangenen Teils.
 * - Und der Fehler, den man dann sieht, ist „Unexpected token 'S'" mit
 *   fünfzehn Zeichen Umgebung. Das ist zu wenig, um zu wissen, was das
 *   Modell eigentlich geschrieben hat.
 *
 * Die eigentliche Kur gegen fehlerhaftes JSON ist ein erzwungenes Schema —
 * siehe JsonSchema in lib/llm.ts. Das hier ist das Netz darunter, für die
 * Aufrufe, deren Form zu groß für ein Schema ist.
 */

export class JsonReplyError extends Error {
  /** Was das Modell wirklich geschrieben hat, gekürzt. */
  readonly excerpt: string;

  constructor(message: string, excerpt: string) {
    super(message);
    this.name = "JsonReplyError";
    this.excerpt = excerpt;
  }
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  const bodies = extract(raw);
  if (!bodies.length) {
    throw new JsonReplyError(
      "Die Antwort enthielt kein JSON-Objekt.",
      snippet(raw, 0),
    );
  }

  // Jeder Kandidat dreimal: wie er ist, repariert, und zugemacht. Mehrere
  // Kandidaten, weil ein einleitender Satz eine geschweifte Klammer enthalten
  // kann — „Hier ist das Ergebnis {…}" — und der erste Fund dann ein
  // vollständig geklammertes Stück Fließtext ist.
  for (const body of bodies) {
    for (const candidate of [body, repair(body), close(repair(body))]) {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Der nächste Versuch ist der reparierte.
      }
    }
  }

  // Für die Fehlermeldung zählt der größte Fund — das ist fast immer der,
  // den das Modell gemeint hat.
  const body = bodies.reduce((a, b) => (b.length > a.length ? b : a));

  // Die Stelle aus dem echten Fehler holen, damit im Studio steht, WAS das
  // Modell geschrieben hat, und nicht nur, dass es falsch war.
  let at = 0;
  try {
    JSON.parse(body);
  } catch (err) {
    at = Number(/position (\d+)/.exec((err as Error).message)?.[1] ?? 0);
  }
  throw new JsonReplyError(
    "Die Antwort des Modells war kein gültiges JSON.",
    snippet(body, at),
  );
}

/**
 * Das erste vollständige Objekt im Text, klammerweise abgezählt.
 *
 * Zeichenkettenbewusst: eine geschweifte Klammer in einer Beschreibung zählt
 * nicht mit, und ein maskiertes Anführungszeichen beendet die Zeichenkette
 * nicht. Findet sich keine schließende Klammer — weil abgeschnitten wurde —
 * kommt der Rest ab der öffnenden zurück, den `close()` dann zumacht.
 */
function extract(raw: string): string[] {
  // Ein Zaun aus Backticks ist die häufigste Verpackung und die einzige, die
  // sich sicher entfernen lässt.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const text = fenced ? fenced[1] : raw;

  const found: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) found.push(text.slice(start, i + 1));
    }
  }
  // Ein offen gebliebenes Objekt am Ende: abgeschnitten. Kommt als eigener
  // Kandidat mit, damit close() retten kann, was schon dasteht.
  if (depth > 0 && start >= 0) found.push(text.slice(start));
  return found;
}

/**
 * Die zwei Fehler, die sich gefahrlos beheben lassen.
 *
 * Ein Komma vor einer schließenden Klammer, und ein echter Zeilenumbruch
 * mitten in einer Zeichenkette — beides kommt vor, beides ist eindeutig, und
 * beides lässt sich reparieren, ohne den Inhalt zu erraten.
 *
 * Was hier bewusst NICHT passiert: fehlende Anführungszeichen ergänzen. Genau
 * dieser Fehler hat den YouTube-Text einmal gekostet, aber ein Ratespiel
 * darüber, wo eine Zeichenkette anfängt, würde aus einem sichtbaren Fehler
 * einen stillen machen. Dagegen hilft das Schema, nicht der Parser.
 */
function repair(body: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else out += ch;
      continue;
    }
    if (ch === ",") {
      const next = body.slice(i + 1).match(/^\s*([}\]])/);
      if (next) continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Ein abgeschnittenes Objekt zumachen.
 *
 * Rettet, was schon dasteht. Bei einer Liste von drei Titeln, von denen der
 * dritte im Token-Limit steckengeblieben ist, sind zwei Titel besser als ein
 * Fehler — und die Prüfung danach wirft ohnehin weg, was unvollständig ist.
 */
function close(body: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const ch of body) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }

  let out = body;
  if (inString) out += '"';
  // Ein angefangener Schlüssel ohne Wert kippt sonst den ganzen Versuch.
  out = out.replace(/,\s*$/, "").replace(/:\s*$/, ": null");
  while (stack.length) {
    out += stack.pop() === "{" ? "}" : "]";
  }
  return out;
}

function snippet(text: string, at: number): string {
  const from = Math.max(0, at - 120);
  return `${from > 0 ? "…" : ""}${text.slice(from, at + 120)}${
    at + 120 < text.length ? "…" : ""
  }`;
}
