import { decisions } from "@/lib/decisions";
import { clientIp, rateLimit } from "@/lib/rate-limit";

type Op = keyof typeof decisions;

// Inputs larger than any real call or incident list are rejected, so the route
// can't be used as a general-purpose LLM proxy.
const MAX_BODY = 16_000;
const MAX_TRANSCRIPT = 1_000;
const MAX_INCIDENTS = 6;

function invalid(op: Op, arg: unknown): string | null {
  if (op === "priority" || op === "facts")
    return typeof arg === "string" && arg.length <= MAX_TRANSCRIPT ? null : "transcript must be a string ≤ 1000 chars";
  const ok =
    !!arg && typeof arg === "object" &&
    typeof (arg as { new_call?: { transcript?: unknown } }).new_call?.transcript === "string" &&
    Object.keys(arg).length <= MAX_INCIDENTS + 1;
  return ok ? null : "state must have new_call.transcript and at most 6 incidents";
}

// Stateless proxy to Jev / Haiku so the OpenRouter key never reaches the browser.
export async function POST(req: Request) {
  const retryAfter = rateLimit(clientIp(req));
  if (retryAfter)
    return Response.json(
      { error: `Rate limit reached. Try again in ${retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );

  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json({ error: "request too large" }, { status: 413 });
  let op: Op, arg: unknown;
  try {
    ({ op, arg } = JSON.parse(text));
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!Object.hasOwn(decisions, op)) return Response.json({ error: "unknown op" }, { status: 400 });
  const bad = invalid(op, arg);
  if (bad) return Response.json({ error: bad }, { status: 400 });

  try {
    return Response.json(await decisions[op](arg as never));
  } catch (e) {
    console.error(`decide ${op} failed:`, (e as Error).message);
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
