export type Priority = "P1" | "P2" | "P3" | "P4";

export interface RawCall {
  id: string;
  t: number; // seconds after the first call
  transcript: string;
  lat: number; // carrier (wireless Phase II) location
  lng: number;
  truth: string; // ground-truth incident key, used only for scoring
}

export interface Facts {
  type: string;
  location_spoken: string;
  summary: string;
  injuries: string;
  trapped: boolean;
  hazards: string[];
  vulnerable: string[];
}

export interface ProcessedCall extends RawCall {
  arrivedAt: number;
  decidedAt?: number;
  flaggedAt?: number; // priority known
  priorityMs?: number;
  facts?: Facts;
  priority?: Priority;
  priorityConf?: number;
  ruleHit?: string;
  incidentId?: string;
  decision?: "merged" | "new" | "review";
  matchProb?: number;
  matchCandidate?: string;
  reason?: string;
  jevMs?: number;
  llmMs?: number; // fact extraction latency
  shadowMs?: number; // LLM doing the same decisions (baseline)
  shadowAgree?: boolean;
  error?: string;
}

export interface TimelineEvent {
  at: number;
  callId: string;
  text: string;
  escalation?: boolean;
}

export interface Incident {
  id: string;
  label: string;
  priority: Priority;
  lat: number;
  lng: number;
  callIds: string[];
  createdAt: number;
  lastCallAt: number;
  timeline: TimelineEvent[];
  isolated: boolean; // created while a larger incident was active → "hidden emergency"
}

export interface Metrics {
  callsProcessed: number;
  incidents: number;
  dupRecall: number | null; // share of duplicate calls correctly merged
  falseMerges: number; // calls merged into an incident belonging to a different real event
  hiddenSurfaced: string; // e.g. "5/5"
  avgJevMs: number | null;
  avgShadowMs: number | null;
  shadowAgreement: number | null;
  avgTimeToFlagP1Ms: number | null;
}

export interface Snapshot {
  running: boolean;
  startedAt: number | null;
  calls: ProcessedCall[];
  incidents: Incident[];
  metrics: Metrics;
  version: number;
}
