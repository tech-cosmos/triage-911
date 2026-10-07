import { decisions } from "@/lib/decisions";

type Op = keyof typeof decisions;

// Stateless proxy to Jev / Haiku so the OpenRouter key never reaches the browser.
export async function POST(req: Request) {
  const { op, arg } = (await req.json()) as { op: Op; arg: never };
  if (!(op in decisions)) return Response.json({ error: "unknown op" }, { status: 400 });
  try {
    return Response.json(await decisions[op](arg));
  } catch (e) {
    console.error(`decide ${op} failed:`, (e as Error).message);
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
