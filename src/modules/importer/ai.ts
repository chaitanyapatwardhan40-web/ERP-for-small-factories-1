import "server-only";
import { ENTITIES, type EntityKind, type Mapping } from "./mapping";

export type AiAdvice = { kind: EntityKind; mapping: Mapping; notes: string[]; model: string };

/**
 * Ask Claude to look at the headers and a few rows and say what the sheet
 * is and how its columns map. Only called when ANTHROPIC_API_KEY is set;
 * any failure falls back to the heuristics silently.
 */
export async function adviseWithClaude(headers: string[], sample: Record<string, string>[], guess: EntityKind): Promise<AiAdvice | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
    const catalog = Object.entries(ENTITIES)
      .map(([k, e]) => `${k}: ${e.fields.map((f) => `${f.key}${f.required ? "*" : ""}`).join(", ")}`)
      .join("\n");
    const prompt = `You are the implementer for a small-factory ERP. A shop uploaded a spreadsheet.

Headers: ${JSON.stringify(headers)}
First rows: ${JSON.stringify(sample.slice(0, 5))}
Heuristic guess of the sheet kind: ${guess}

Entity kinds and their fields (* = required):
${catalog}

Reply with JSON only: {"kind": <entity kind>, "mapping": {<field key>: <header or null>}, "notes": [<short notes about data quality, duplicates, units, anything the shop should check>]}`;
    const msg = await client.messages.create({ model, max_tokens: 1200, messages: [{ role: "user", content: prompt }] });
    const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as { kind?: string; mapping?: Record<string, string | null>; notes?: string[] };
    const kind = (parsed.kind && parsed.kind in ENTITIES ? parsed.kind : guess) as EntityKind;
    const mapping: Mapping = {};
    for (const f of ENTITIES[kind].fields) {
      const h = parsed.mapping?.[f.key];
      mapping[f.key] = h && headers.includes(h) ? h : null;
    }
    return { kind, mapping, notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 8).map(String) : [], model };
  } catch {
    return null;
  }
}
