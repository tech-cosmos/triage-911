import { CALLS, MAIN_EVENT } from "./data";
import type { DecisionApi, MatchState } from "./decisions";
import type { Facts, Incident, Metrics, Priority, ProcessedCall, RawCall, Snapshot } from "./types";

// The engine holds all incident state and runs wherever it is created (the browser,
// or the headless eval script). Model calls go through an injected, stateless API.
let api: DecisionApi;
let listener: () => void = () => {};
export function configure(decisionApi: DecisionApi, onChange?: () => void) {
  api = decisionApi;
  if (onChange) listener = onChange;
}

// Decision thresholds on Jev's P(same incident). A false merge (hiding a separate
// emergency inside a bigger one) is far worse than a missed duplicate, so the
// auto-merge bar is high and the grey zone goes to a human.
const AUTO_MERGE = 0.7;
const REVIEW = 0.3;
const MAX_CANDIDATES = 6;
const BIG_INCIDENT = 5; // an incident with this many calls counts as "the spike"

// Hard floor: these phrases force P1 no matter what any model says.
const P1_RULES: [RegExp, string][] = [
  [/not breathing|isn'?t breathing|stopped breathing|not responding|unresponsive|unconscious|(he|she|man|woman|someone|person|husband|wife) (just )?collapsed|he'?s blue|she'?s blue/i, "unresponsive / not breathing"],
  [/\b(gun|knife|shot|stabbed|kill me)\b/i, "weapon / threat to kill"],
  [/\btrapped\b|can'?t get (out|down)|stuck in|still people inside|people inside/i, "people trapped"],
  [/\bjumped\b|not moving/i, "fall from height / not moving"],
];

const RANK: Record<Priority, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };

interface Store {
  running: boolean;
  startedAt: number | null;
  calls: ProcessedCall[];
  incidents: Incident[];
  version: number;
  lock: Promise<unknown>;
  timers: ReturnType<typeof setTimeout>[];
  nextIncident: number;
}

function fresh(): Store {
  return { running: false, startedAt: null, calls: [], incidents: [], version: 0, lock: Promise.resolve(), timers: [], nextIncident: 1 };
}
const store: Store = fresh();

const bump = () => {
  store.version++;
  listener();
};

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = store.lock.then(fn, fn);
  store.lock = run.catch(() => {});
  return run;
}

function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dy = (a.lat - b.lat) * 111_000;
  const dx = (a.lng - b.lng) * 84_400;
  return Math.round(Math.hypot(dx, dy));
}

const callById = (id: string) => store.calls.find((c) => c.id === id)!;
// After any await: a reset may have started a new run; stale calls must not touch it.
const live = (call: ProcessedCall) => store.calls.includes(call);

function ruleFloor(text: string) {
  for (const [re, label] of P1_RULES) if (re.test(text)) return label;
  return undefined;
}

// ---------------- the pipeline ----------------

export async function processCall(raw: RawCall) {
  const call: ProcessedCall = { ...raw, arrivedAt: Date.now() };
  call.ruleHit = ruleFloor(raw.transcript);
  store.calls.push(call);
  bump();

  // Three things run in parallel: priority (Jev, never queued, so a P1 is flagged
  // within one round-trip), matching (Jev, serialized because it reads/writes the
  // incident list), and fact extraction (LLM, never blocks a decision).
  const extraction = extractFacts(call);
  const priority = flagPriority(call).catch((e) => fail(call, e));
  try {
    await serialize(() => decide(call, priority));
  } catch (e) {
    fail(call, e);
  }
  await extraction;
}

function fail(call: ProcessedCall, e: unknown) {
  call.error = (call.error ? call.error + "; " : "") + (e as Error).message;
  bump();
}

async function flagPriority(call: ProcessedCall) {
  const { priority, confidence, ms } = await api.priority(call.transcript);
  call.priority = priority;
  call.priorityConf = confidence;
  if (call.ruleHit && call.priority !== "P1") {
    call.reason = `Rule floor → P1 (${call.ruleHit}); Jev said ${call.priority}. `;
    call.priority = "P1";
  }
  call.flaggedAt = Date.now();
  call.priorityMs = Math.round(ms);
  bump();
}

async function decide(call: ProcessedCall, priority: Promise<unknown>) {
  const candidates = store.incidents
    .map((inc) => ({ inc, d: meters(call, inc) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_CANDIDATES);

  const state: MatchState = { new_call: { transcript: call.transcript } };
  for (const { inc, d } of candidates) {
    state[inc.id] = {
      caller_location_distance_m: d,
      calls: inc.callIds.slice(0, 2).concat(inc.callIds.slice(-2)).filter((v, i, a) => a.indexOf(v) === i)
        .map((id) => callById(id).transcript),
    };
  }

  const { probs, ms } = candidates.length ? await api.match(state) : { probs: {} as Record<string, number>, ms: 0 };
  call.jevMs = Math.round(ms) || undefined;
  call.decidedAt = Date.now();
  await priority; // incident priority/escalation needs this call's priority
  if (!live(call)) return;

  let best: { inc: Incident; d: number; p: number } | undefined;
  for (const { inc, d } of candidates) {
    const prob = probs[inc.id] ?? 0;
    if (!best || prob > best.p) best = { inc, d, p: prob };
  }

  const why = (b: typeof best) => `${b!.d}m away, Jev P(same as ${b!.inc.id}) = ${b!.p.toFixed(2)}`;
  if (best && best.p >= AUTO_MERGE) {
    call.decision = "merged";
    call.matchProb = best.p;
    call.reason = (call.reason ?? "") + `Merged: ${why(best)}.`;
    attach(call, best.inc);
  } else if (best && best.p >= REVIEW) {
    call.decision = "review";
    call.matchProb = best.p;
    call.matchCandidate = best.inc.id;
    call.reason = (call.reason ?? "") + `Uncertain: ${why(best)}. Needs dispatcher.`;
  } else {
    call.decision = "new";
    call.matchProb = best?.p;
    call.reason = (call.reason ?? "") + (best ? `New incident: closest was ${why(best)}.` : "First call.");
    createIncident(call);
  }
  bump();

  void shadowBaseline(call, state, best);
}

function createIncident(call: ProcessedCall) {
  const spikeActive = store.incidents.some((i) => i.callIds.length >= BIG_INCIDENT);
  const inc: Incident = {
    id: `INC-${store.nextIncident++}`,
    label: call.facts ? labelFrom(call.facts) : call.transcript.slice(0, 70),
    priority: call.priority ?? "P3",
    lat: call.lat,
    lng: call.lng,
    callIds: [call.id],
    createdAt: Date.now(),
    lastCallAt: Date.now(),
    timeline: [{ at: Date.now(), callId: call.id, text: call.transcript }],
    isolated: spikeActive,
  };
  call.incidentId = inc.id;
  store.incidents.push(inc);
}

function attach(call: ProcessedCall, inc: Incident) {
  call.incidentId = inc.id;
  inc.callIds.push(call.id);
  inc.lastCallAt = Date.now();
  const escalation = !!call.priority && RANK[call.priority] < RANK[inc.priority];
  if (escalation) inc.priority = call.priority!;
  // Only log calls that carry something beyond "there's a fire".
  if (escalation || call.ruleHit) logNew(inc, call, true);
  else if (call.facts && (call.facts.trapped || call.facts.vulnerable?.length)) logNew(inc, call, false);
}

function logNew(inc: Incident, call: ProcessedCall, escalation: boolean) {
  if (inc.timeline.some((t) => t.callId === call.id)) return;
  inc.timeline.unshift({ at: Date.now(), callId: call.id, text: call.transcript, escalation });
}

export function review(callId: string, action: "merge" | "separate") {
  const call = callById(callId);
  if (!call || call.decision !== "review") return false;
  const target = store.incidents.find((i) => i.id === call.matchCandidate);
  if (action === "merge" && target) {
    call.decision = "merged";
    call.reason += " Dispatcher merged.";
    attach(call, target);
  } else {
    call.decision = "new";
    call.reason += " Dispatcher kept separate.";
    createIncident(call);
  }
  bump();
  return true;
}

// ---------------- LLM side ----------------

const labelFrom = (f: Facts) => `${f.type}${f.location_spoken ? ` — ${f.location_spoken}` : ""}`;

async function extractFacts(call: ProcessedCall) {
  try {
    const { facts: data, ms } = await api.facts(call.transcript);
    if (!live(call)) return;
    call.facts = data;
    call.llmMs = Math.round(ms);
    const inc = store.incidents.find((i) => i.id === call.incidentId);
    if (inc?.callIds[0] === call.id) inc.label = labelFrom(data);
    else if (inc && (data.trapped || data.vulnerable?.length)) logNew(inc, call, false);
    bump();
  } catch (e) {
    call.error = (call.error ? call.error + "; " : "") + (e as Error).message;
    bump();
  }
}

// Same two decisions made by the LLM, off the critical path, to compare speed and agreement.
async function shadowBaseline(
  call: ProcessedCall,
  state: MatchState,
  best: { inc: Incident; p: number } | undefined,
) {
  try {
    const { sameAs, ms } = await api.shadow(state);
    call.shadowMs = Math.round(ms);
    const jevSame = best && best.p >= AUTO_MERGE ? best.inc.id : null;
    call.shadowAgree = sameAs === jevSame;
    bump();
  } catch {
    /* baseline is best-effort */
  }
}

// ---------------- simulation + metrics ----------------

export function reset() {
  store.timers.forEach(clearTimeout);
  Object.assign(store, fresh(), { version: store.version });
  bump();
}

export function startSimulation(speed: number) {
  reset();
  store.running = true;
  store.startedAt = Date.now();
  let remaining = CALLS.length;
  for (const c of CALLS) {
    store.timers.push(
      setTimeout(() => {
        processCall(c).finally(() => {
          if (--remaining === 0) {
            store.running = false;
            bump();
          }
        });
      }, (c.t * 1000) / speed),
    );
  }
  bump();
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

function metrics(): Metrics {
  const calls = store.calls.filter((c) => c.decision);
  const owner = new Map<string, string | undefined>(); // incident → truth of its first call
  for (const inc of store.incidents) owner.set(inc.id, callById(inc.callIds[0])?.truth);

  let dups = 0, merged = 0;
  const groups = new Map<string, ProcessedCall[]>();
  for (const c of calls) groups.set(c.truth, [...(groups.get(c.truth) ?? []), c]);
  for (const group of groups.values()) {
    const home = group[0].incidentId;
    dups += group.length - 1;
    merged += group.slice(1).filter((c) => c.incidentId && c.incidentId === home).length;
  }

  const falseMerges = calls.filter((c) => c.incidentId && owner.get(c.incidentId) !== c.truth).length;
  const hidden = [...groups.keys()].filter((k) => k !== MAIN_EVENT);
  const surfaced = hidden.filter((k) => {
    const first = groups.get(k)![0];
    return first.incidentId && owner.get(first.incidentId) === k;
  });

  const shadow = calls.filter((c) => c.shadowAgree !== undefined);
  return {
    callsProcessed: calls.length,
    incidents: store.incidents.length,
    dupRecall: dups ? merged / dups : null,
    falseMerges,
    hiddenSurfaced: `${surfaced.length}/${hidden.length}`,
    avgJevMs: avg(calls.flatMap((c) => (c.jevMs ? [c.jevMs] : []))),
    avgShadowMs: avg(shadow.flatMap((c) => (c.shadowMs ? [c.shadowMs] : []))),
    shadowAgreement: shadow.length ? shadow.filter((c) => c.shadowAgree).length / shadow.length : null,
    avgTimeToFlagP1Ms: avg(calls.filter((c) => c.priority === "P1" && c.flaggedAt).map((c) => c.flaggedAt! - c.arrivedAt)),
  };
}

export function snapshot(): Snapshot {
  return {
    running: store.running,
    startedAt: store.startedAt,
    calls: store.calls.map((c) => ({ ...c })),
    incidents: store.incidents.map((i) => ({ ...i, callIds: [...i.callIds], timeline: [...i.timeline] })).sort(
      (a, b) => RANK[a.priority] - RANK[b.priority] || b.lastCallAt - a.lastCallAt,
    ),
    metrics: metrics(),
    version: store.version,
  };
}
