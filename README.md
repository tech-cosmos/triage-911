# Triage 911

When an incident causes a spike in 911 calls, Triage 911 groups duplicate reports into one incident and flags high-priority cases, including separate emergencies that would otherwise be buried in the spike.

**Live demo: https://triage-911.vercel.app** (click **▶ Simulate spike**)

**Launch video (30 s): [triage-911-cutscene.mp4](https://github.com/tech-cosmos/triage-911/releases/download/v1.0/triage-911-cutscene.mp4)**

## Project description (hackathon submission)

> Triage 911 merges duplicate 911 calls during a spike and flags urgent ones in ~350ms using the Jev System 1 model. In a 57-call test: 0 wrong merges, 5/5 hidden emergencies found.

## About the project

**Triage 911 finds the one call that matters in a flood of calls about the same thing.**

When a building catches fire, dozens of people call 911 to report the same smoke. Dispatchers have to listen to each call to find out whether it's new, so one fire can tie up the whole center. The worst case is a separate emergency calling in the middle of the spike, like a cardiac arrest two blocks away, and waiting in line behind 40 fire reports.

Triage 911 groups duplicate reports into one incident, ranks every call by urgency, and brings separate emergencies to the top. Each new call is handled in parallel:

- **Priority:** Jev, TypeSafe's System 1 decisions model, rates the call P1–P4 with calibrated probabilities in about 200–350ms. Fixed rules ("not breathing", "knife", "trapped") force P1, and no model can lower them.
- **Same incident?** Jev compares the call with every nearby incident in one request and returns a probability for each. A high probability merges the call automatically, a middling one goes to a dispatcher for one-click review, and a low one opens a new incident.
- **Facts:** Claude Haiku pulls out the incident type, spoken location, injuries, trapped people and vulnerable people (children, wheelchair users, pregnant women). It never delays a decision.

Duplicates are merged, never dropped. When the 15th caller says "there's a kid on the fire escape," that detail goes into the incident's timeline and can raise its priority.

**Results on a simulated spike** of 57 calls: one apartment fire described 48 different ways, plus five unrelated emergencies hidden in the stream, some only 300m away.

- 57 calls → 6 incidents
- 100% of duplicates merged automatically
- **0 separate emergencies wrongly merged**
- **5/5 hidden emergencies brought to the top**
- P1 calls flagged in about 350ms, including the network round-trip
- Jev made each match decision 5–8× faster than an LLM making the same decision (about 0.2–0.3s against 1.6s), and the two agreed 100% of the time
- A caller relaying a friend's text from 2km away was still matched to the right fire

**Why a System 1 model:** "Is this the same incident?" and "how urgent is this?" are quick yes-or-ranked decisions, not writing tasks. Jev answers them with calibrated probabilities instead of generated text. That makes it fast enough to use on every call in a spike, and the probabilities give natural thresholds for when to ask a human. The LLM handles the part that needs language: pulling structured facts out of panicked speech.

**Built with:** Next.js on Vercel, Jev (`typesafe/jev-1.13`) and Claude Haiku 5.5 through OpenRouter, Leaflet.

**Limitations and next steps:** The results come from synthetic transcripts, and the merge thresholds were set using that same data. Next steps are real audio with live speech-to-text, the location data phone carriers send with 911 calls, a shared incident store for many dispatchers, and testing on historical call data.

## Run

```bash
npm install
npm run dev        # needs OPENROUTER_API_KEY in .env.local
```

Open the page and click **▶ Simulate spike**. It streams 57 calls: 48 about one apartment fire on W 23rd St, plus 5 unrelated emergencies hidden in the stream. Some are only about 300m away, such as a cardiac arrest at 8th Ave & 21st.

Click **📍 Near me** to share your location (the browser asks for permission first). Incidents are then sorted closest-first, each card shows its distance, you appear on the map, and the nearest incident opens automatically. Click again to go back to priority order. Your location stays in the browser and is never sent to the server.

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
