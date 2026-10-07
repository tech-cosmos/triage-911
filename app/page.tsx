"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Incident, ProcessedCall, Snapshot } from "@/lib/types";
import { configure, reset, review, snapshot, startSimulation } from "@/lib/engine";
import { clientApi } from "@/lib/client-api";

const IncidentMap = dynamic(() => import("@/components/IncidentMap"), { ssr: false });

const since = (from: number | null, at: number) => (from ? `+${((at - from) / 1000).toFixed(1)}s` : "");
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const ms = (x: number | null) => (x === null ? "—" : `${x}ms`);

type LatLng = { lat: number; lng: number };
type LocState = { status: "off" | "asking" | "denied" | "unavailable" } | { status: "on"; me: LatLng };

function distanceM(a: LatLng, b: LatLng) {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : m < 100_000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`);

export default function Dashboard() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [speed, setSpeed] = useState(3);
  const [selected, setSelected] = useState<string | null>(null);
  const [loc, setLoc] = useState<LocState>({ status: "off" });

  // Asked only on click, so the browser permission prompt has context.
  const locate = () => {
    if (loc.status === "on") return setLoc({ status: "off" });
    if (!("geolocation" in navigator)) return setLoc({ status: "unavailable" });
    setLoc({ status: "asking" });
    navigator.geolocation.getCurrentPosition(
      (p) => { setSelected(null); setLoc({ status: "on", me: { lat: p.coords.latitude, lng: p.coords.longitude } }); },
      (e) => setLoc({ status: e.code === e.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };
  const me = loc.status === "on" ? loc.me : null;

  useEffect(() => {
    // Coalesce engine updates into at most one render per frame.
    let frame = 0;
    configure(clientApi, () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        try { setSnap(snapshot()); } catch (e) { console.error(e); }
      });
    });
    setSnap(snapshot());
    return () => cancelAnimationFrame(frame);
  }, []);


  const calls = snap?.calls ?? [];
  // With the user's location, nearest incident first; otherwise the engine's priority order.
  const incidents = useMemo(() => {
    const list = snap?.incidents ?? [];
    return me ? [...list].sort((a, b) => distanceM(me, a) - distanceM(me, b)) : list;
  }, [snap, me]);
  const distOf = (i: Incident) => (me ? fmtDist(distanceM(me, i)) : undefined);
  const byId = useMemo(() => new Map(calls.map((c) => [c.id, c])), [calls]);
  const main = useMemo(
    () => incidents.reduce<Incident | null>((a, b) => (!a || b.callIds.length > a.callIds.length ? b : a), null),
    [incidents],
  );
  const hidden = incidents.filter((i) => i.isolated && i.id !== main?.id);
  const reviewQueue = calls.filter((c) => c.decision === "review");
  const sel = incidents.find((i) => i.id === selected) ?? (me ? incidents[0] : main);
  const onSelect = useCallback((id: string) => setSelected(id), []);
  const m = snap?.metrics;
  const speedup = m?.avgJevMs && m?.avgShadowMs ? (m.avgShadowMs / m.avgJevMs).toFixed(1) : null;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="dot" data-live={snap?.running} />
          TRIAGE<b>911</b>
          <span className="sub">duplicate detection &amp; priority flagging · decisions by Jev</span>
        </div>
        <div className="controls">
          <button className={loc.status === "on" ? "loc on" : "loc"} onClick={locate} disabled={loc.status === "asking"}
            title={loc.status === "on" ? "Back to priority order" : "Sort incidents by distance from you"}>
            {loc.status === "asking" ? "Locating…" : loc.status === "on" ? "📍 Nearest first ✓" : "📍 Near me"}
          </button>
          {(loc.status === "denied" || loc.status === "unavailable") && (
            <span className="loc-err">{loc.status === "denied" ? "Location permission denied" : "Location unavailable"}</span>
          )}
          <label>
            speed
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {[1, 3, 6, 12].map((s) => (
                <option key={s} value={s}>{s}×</option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={snap?.running} onClick={() => { setSelected(null); startSimulation(speed); }}>
            {snap?.running ? "Spike in progress…" : "▶ Simulate spike"}
          </button>
          <button onClick={() => { setSelected(null); reset(); }}>Reset</button>
        </div>
      </header>

      <section className="metrics">
        <Metric label="calls → incidents" value={m ? `${m.callsProcessed} → ${m.incidents}` : "—"} />
        <Metric label="duplicates auto-merged" value={pct(m?.dupRecall ?? null)} />
        <Metric label="false merges" value={m ? String(m.falseMerges) : "—"} tone={m?.falseMerges ? "bad" : "good"} />
        <Metric label="hidden emergencies surfaced" value={m?.hiddenSurfaced ?? "—"} tone="good" />
        <Metric label="time to flag P1" value={ms(m?.avgTimeToFlagP1Ms ?? null)} />
        <Metric label="Jev match decision" value={ms(m?.avgJevMs ?? null)} tone="good" />
        <Metric
          label={`LLM, same decision${speedup ? ` · ${speedup}× slower` : ""}${m?.shadowAgreement != null ? ` · ${pct(m.shadowAgreement)} agree` : ""}`}
          value={ms(m?.avgShadowMs ?? null)}
        />
      </section>

      <main>
        <section className="panel feed">
          <h2>Incoming calls <span>{calls.length}</span></h2>
          <ul>
            {[...calls].reverse().map((c) => (
              <CallRow key={c.id} c={c} startedAt={snap?.startedAt ?? null} onSelect={onSelect} />
            ))}
            {!calls.length && <li className="empty">Press “Simulate spike” to stream 57 calls: one apartment fire, five unrelated emergencies hidden inside it.</li>}
          </ul>
        </section>

        <section className="panel incidents">
          <h2 className="main-h">Main event</h2>
          <p className="explain">The incident causing the spike: the one with the most calls. New calls about it are merged here instead of queuing for a dispatcher.</p>
          {main ? <IncidentCard i={main} byId={byId} onSelect={onSelect} active={sel?.id === main.id} distance={distOf(main)} isMain />
            : <p className="empty">No calls yet.</p>}

          <h2 className="alert">Not part of the main event <span>{hidden.length}</span></h2>
          <p className="explain">Separate emergencies that came in during the spike. Jev decided they are <b>not</b> the main event, so they get their own response instead of being buried under its calls.</p>
          {hidden.length ? hidden.map((i) => <IncidentCard key={i.id} i={i} byId={byId} onSelect={onSelect} active={sel?.id === i.id} distance={distOf(i)} highlight />)
            : <p className="empty">None yet.</p>}

          {reviewQueue.length > 0 && (
            <>
              <h2 className="review">Needs dispatcher <span>{reviewQueue.length}</span></h2>
              {reviewQueue.map((c) => (
                <div key={c.id} className="card review-card">
                  <div className="row"><b>{c.id}</b><Prio p={c.priority} /><span className="muted">P(same as {c.matchCandidate}) = {c.matchProb?.toFixed(2)}</span></div>
                  <p>{c.transcript}</p>
                  <div className="row">
                    <button onClick={() => review(c.id, "merge")}>Merge into {c.matchCandidate}</button>
                    <button onClick={() => review(c.id, "separate")}>Keep separate</button>
                  </div>
                </div>
              ))}
            </>
          )}

          <h2>All incidents <span>{incidents.length}</span>{me && <em>nearest to you first</em>}</h2>
          {incidents.map((i, n) => (
            <IncidentCard key={i.id} i={i} byId={byId} onSelect={onSelect} active={sel?.id === i.id}
              distance={distOf(i)} nearest={!!me && n === 0} />
          ))}
        </section>

        <section className="panel right">
          <IncidentMap incidents={incidents} calls={calls} selected={sel?.id ?? null} onSelect={onSelect} me={me} />
          {sel && (
            <div className="detail">
              <div className="row"><b>{sel.id}</b><Prio p={sel.priority} /><span className="muted">{sel.callIds.length} calls</span></div>
              <h3>{sel.label}</h3>
              <h4>What's new (escalations &amp; critical details)</h4>
              <ul className="timeline">
                {sel.timeline.map((t) => {
                  const c = byId.get(t.callId);
                  return (
                    <li key={t.callId} className={t.escalation ? "esc" : ""}>
                      <span className="muted">{t.callId} {since(snap?.startedAt ?? null, t.at)}</span>
                      {c?.ruleHit && <span className="tag">⚑ {c.ruleHit}</span>}
                      <p>{c?.facts?.summary ?? t.text}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

function Prio({ p }: { p?: string }) {
  return <span className={`prio ${p ?? "pending"}`}>{p ?? "…"}</span>;
}

function CallRow({ c, startedAt, onSelect }: { c: ProcessedCall; startedAt: number | null; onSelect: (id: string) => void }) {
  const badge =
    c.error && !c.decision ? <span className="badge err">error</span>
    : !c.decision ? <span className="badge pending">deciding…</span>
    : c.decision === "merged" ? <span className="badge merged">merged → {c.incidentId}</span>
    : c.decision === "review" ? <span className="badge review">review</span>
    : <span className="badge new">NEW {c.incidentId}</span>;
  return (
    <li className={`call ${c.decision ?? ""}`} onClick={() => c.incidentId && onSelect(c.incidentId)} title={c.reason ?? c.error}>
      <div className="row">
        <b>{c.id}</b>
        <span className="muted">{since(startedAt, c.arrivedAt)}</span>
        <Prio p={c.priority} />
        {badge}
        {c.jevMs && <span className="muted ms">{c.jevMs}ms</span>}
      </div>
      <p>{c.transcript}</p>
      {c.reason && <p className="reason">{c.reason}</p>}
    </li>
  );
}

function IncidentCard({ i, byId, onSelect, active, highlight, distance, nearest, isMain }: {
  i: Incident; byId: Map<string, ProcessedCall>; onSelect: (id: string) => void; active: boolean; highlight?: boolean;
  distance?: string; nearest?: boolean; isMain?: boolean;
}) {
  const facts = byId.get(i.callIds[0])?.facts;
  const vulnerable = [...new Set(i.callIds.flatMap((id) => byId.get(id)?.facts?.vulnerable ?? []))];
  return (
    <div className={`card ${active ? "active" : ""} ${highlight ? "hl" : ""} ${isMain ? "main" : ""}`} onClick={() => onSelect(i.id)}>
      <div className="row">
        <b>{i.id}</b>
        <Prio p={i.priority} />
        {nearest && <span className="nearest">Closest to you</span>}
        <span className="count">{distance && <span className="dist">{distance} · </span>}{i.callIds.length} call{i.callIds.length > 1 ? "s" : ""}</span>
      </div>
      <h3>{i.label}</h3>
      {facts && <p className="muted">{facts.injuries}{facts.hazards?.length ? ` · ${facts.hazards.join(", ")}` : ""}</p>}
      {vulnerable.length > 0 && <div className="tags">{vulnerable.map((v) => <span key={v} className="tag">{v}</span>)}</div>}
    </div>
  );
}
