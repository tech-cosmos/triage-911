// Headless run of the full spike (sequential, no timing) → prints decisions + metrics.
import { CALLS } from "../lib/data";
import { decisions } from "../lib/decisions";
import { configure, processCall, snapshot } from "../lib/engine";

configure(decisions);

for (const c of CALLS) {
  await processCall(c);
  const p = snapshot().calls.find((x) => x.id === c.id)!;
  console.log(`${p.id} ${p.truth.padEnd(8)} ${p.priority} ${(p.decision ?? "ERR").padEnd(6)} ${p.incidentId ?? "-"}  jev=${p.jevMs}ms  ${p.error ?? p.reason}`);
}
await new Promise((r) => setTimeout(r, 4000)); // let shadow baselines land
const s = snapshot();
for (const i of s.incidents) console.log(`${i.id} ${i.priority} calls=${i.callIds.length} isolated=${i.isolated} ${i.label}`);
console.log(s.metrics);
