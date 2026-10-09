// Fixed-window rate limiter kept in function memory. Each serverless instance has
// its own counters, so the limits are approximate — enough to stop casual abuse of
// the OpenRouter key without needing a database.

// One demo run is ~57 calls × 4 ops ≈ 230 requests, so a visitor can do about two
// runs per 5 minutes; the global cap bounds total spend per instance.
const PER_IP = { limit: 500, windowMs: 5 * 60_000 };
const GLOBAL = { limit: 4000, windowMs: 60 * 60_000 };

type Window = { count: number; resetAt: number };
const ips = new Map<string, Window>();
let global: Window = { count: 0, resetAt: 0 };

function hit(w: Window | undefined, rule: { limit: number; windowMs: number }, now: number): Window {
  if (!w || now >= w.resetAt) return { count: 1, resetAt: now + rule.windowMs };
  w.count++;
  return w;
}

export function clientIp(req: Request) {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

// Returns seconds to wait, or 0 if the request is allowed.
export function rateLimit(ip: string, now = Date.now()): number {
  if (ips.size > 10_000) for (const [k, w] of ips) if (now >= w.resetAt) ips.delete(k);

  const w = hit(ips.get(ip), PER_IP, now);
  ips.set(ip, w);
  global = hit(global, GLOBAL, now);

  if (w.count > PER_IP.limit) return Math.ceil((w.resetAt - now) / 1000);
  if (global.count > GLOBAL.limit) return Math.ceil((global.resetAt - now) / 1000);
  return 0;
}
