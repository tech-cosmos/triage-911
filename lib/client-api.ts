import type { DecisionApi } from "./decisions";

async function call(op: string, arg: unknown) {
  const res = await fetch("/api/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, arg }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `decide ${res.status}`);
  return body;
}

export const clientApi: DecisionApi = {
  priority: (transcript) => call("priority", transcript),
  match: (state) => call("match", state),
  facts: (transcript) => call("facts", transcript),
  shadow: (state) => call("shadow", state),
};
