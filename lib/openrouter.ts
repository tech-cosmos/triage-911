const BASE = "https://openrouter.ai/api";
export const JEV_MODEL = "typesafe/jev-1.13";
export const LLM_MODEL = "anthropic/claude-haiku-5.5";

function key() {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) throw new Error("OPENROUTER_API_KEY missing from .env.local");
  return k;
}

// ---- Jev (System 1 decisions model) ----

export type JevQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number };

export async function jevDecide(
  state: Record<string, unknown>,
  questions: Record<string, JevQuestion>,
): Promise<{ answers: Record<string, JevAnswer>; ms: number }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/alpha/decisions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Jev ${res.status}: ${body?.error?.message ?? "unknown error"}`);
  return { answers: body.answers, ms: performance.now() - t0 };
}

// ---- LLM (fact extraction + shadow baseline) ----

export async function llmJson<T>(system: string, user: string): Promise<{ data: T; ms: number }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`LLM ${res.status}: ${body?.error?.message ?? "unknown error"}`);
  const text: string = body.choices[0].message.content;
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return { data: JSON.parse(json) as T, ms: performance.now() - t0 };
}
