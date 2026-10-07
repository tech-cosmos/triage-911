# Triage 911

When an incident causes a spike in 911 calls, Triage 911 groups duplicate reports into one incident and flags high-priority cases, including separate emergencies that would otherwise be buried in the spike.

**Live demo: https://triage-911.vercel.app** (click **▶ Simulate spike**)

## Run

```bash
npm install
npm run dev        # needs OPENROUTER_API_KEY in .env.local
```

Open the page and click **▶ Simulate spike**. It streams 57 calls: 48 about one apartment fire on W 23rd St, plus 5 unrelated emergencies hidden in the stream. Some are only about 300m away, such as a cardiac arrest at 8th Ave & 21st.

`npx tsx scripts/eval.ts` runs the same data headless and prints every decision and the metrics.

## How each call is processed

The incident state and the pipeline run in the browser (`lib/engine.ts`). Model calls go through one stateless route, `/api/decide`, so the OpenRouter key stays on the server and the app works on serverless hosting. Three steps run in parallel:

| Step | Model | Why |
|---|---|---|
| **Priority** P1–P4 | Jev (`choice`) + keyword floor | Never queued, so a P1 is flagged in one Jev round-trip (about 300ms). Phrases like "not breathing", "knife" or "trapped" force P1. |
| **Same incident?** | Jev (`noul`), one yes-probability per nearby incident, all in one request | Runs one call at a time because it reads and updates the incident list. ≥0.70 merges automatically, 0.30–0.70 goes to the dispatcher, <0.30 starts a new incident. |
| **Facts**: type, spoken location, injuries, trapped, vulnerable people | Claude Haiku 5.5 | Fills in labels and the "what's new" timeline. Never holds up a decision. |

A shadow baseline also asks Haiku to make the same two decisions, off the critical path, to measure speed and agreement.

## Results on the synthetic spike (from the deployed site, 3× speed)

- 57 calls → 6 incidents, 100% of duplicates auto-merged, **0 wrong merges**
- **5/5 hidden emergencies brought to the top**
- P1 flagged in about 350ms, including the network round-trip. Jev's match decision takes about 190–300ms; Haiku takes about 1.6s for the same decision (5–8× slower) and agreed 100% of the time.
- A relay call ("my friend texted me she's trapped") whose phone was 2km away still merged correctly.

## Design choices

- **Merge duplicates, never drop them.** Each call adds to its incident. New critical details (a child on the fire escape, a wheelchair user on the 4th floor) are logged and can raise the incident's priority.
- **A wrong merge is the worst error**, because it hides a separate emergency. Jev's scores separate cleanly on this data (same incident: 0.75–0.96; different: ≤0.06), and the thresholds keep a wide margin.
- **Models can raise a priority but never lower a keyword-rule P1.**
- Incident state lives in each viewer's browser, so every visitor runs their own simulation. A real dispatch center would keep it in a shared database.
- Each run makes about 170 model calls through the deployer's OpenRouter key.

## Deploy

```bash
npx vercel env add OPENROUTER_API_KEY production
npx vercel deploy --prod
```
