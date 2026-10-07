// Server-side model calls. Stateless: the caller passes everything a decision needs.
import { jevDecide, llmJson, type JevQuestion } from "./openrouter";
import type { Facts, Priority } from "./types";

export type MatchState = { new_call: { transcript: string } } & Record<string, unknown>;

const PRIORITY_CRITERIA: Record<Priority, string> = {
  P1: "Immediate threat to life: not breathing, unconscious, trapped, weapon, active fire with people inside, severe bleeding",
  P2: "Urgent: injury or medical need that is serious but stable, people at risk",
  P3: "Non-life-threatening: minor injury, property damage, person needs help but is safe",
  P4: "Informational: bystander report or question, no new victim or danger",
};

export async function priority(transcript: string) {
  const { answers, ms } = await jevDecide(
    { call: { transcript } },
    { priority: { type: "choice", instructions: "Dispatch priority of this 911 call.", criteria: PRIORITY_CRITERIA } },
  );
  const p = answers.priority;
  return p?.type === "choice"
    ? { priority: p.choice as Priority, confidence: p.confidence, ms }
    : { priority: "P3" as Priority, confidence: undefined, ms };
}

// One noul question per candidate incident, all answered in a single Jev request.
export async function match(state: MatchState) {
  const ids = Object.keys(state).filter((k) => k !== "new_call");
  const questions: Record<string, JevQuestion> = {};
  for (const id of ids)
    questions[`same_${id}`] = {
      type: "noul",
      instructions:
        `Is new_call reporting the same real-world emergency as ${id}? ` +
        `A different emergency nearby (e.g. a medical collapse or crash near a fire) is NOT the same. ` +
        `Callers can be far away if they are watching from a distance or relaying for someone else.`,
    };
  const { answers, ms } = await jevDecide(state, questions);
  const probs: Record<string, number> = {};
  for (const id of ids) {
    const a = answers[`same_${id}`];
    probs[id] = a?.type === "noul" ? a.noul : 0;
  }
  return { probs, ms };
}

export async function facts(transcript: string) {
  const { data, ms } = await llmJson<Facts>(
    `Extract facts from a 911 call transcript. Reply with JSON only:
{"type": short incident type e.g. "Structure fire", "Cardiac arrest", "Vehicle vs cyclist",
 "location_spoken": address/landmark as said by caller or "",
 "summary": <=12 words of what is NEW or notable in this call,
 "injuries": short description or "none mentioned",
 "trapped": boolean,
 "hazards": string[],
 "vulnerable": string[] e.g. ["child","wheelchair user","pregnant","elderly"]}`,
    transcript,
  );
  return { facts: data, ms };
}

// The same two decisions made by an LLM — the speed/agreement baseline.
export async function shadow(state: MatchState) {
  const ids = Object.keys(state).filter((k) => k !== "new_call");
  const { data, ms } = await llmJson<{ priority: Priority; same_as: string | null }>(
    `You are a 911 triage system. Given new_call and existing incidents, reply with JSON only:
{"priority": "P1"|"P2"|"P3"|"P4", "same_as": incident id that new_call is the same real-world emergency as, or null}
P1 immediate threat to life; P2 urgent; P3 non-life-threatening; P4 informational.
A different emergency nearby is NOT the same incident.`,
    JSON.stringify({ ...state, incident_ids: ids }),
  );
  return { priority: data.priority, sameAs: data.same_as ?? null, ms };
}

export const decisions = { priority, match, facts, shadow };
export type DecisionApi = {
  [K in keyof typeof decisions]: (...a: Parameters<(typeof decisions)[K]>) => ReturnType<(typeof decisions)[K]>;
};
