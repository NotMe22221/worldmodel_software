import { acceptRunnerEvidence } from "@/server/github-oidc";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") || ""; const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  try { if (!token) throw new Error("runner_unauthorized: Run token is required"); const raw = await request.text(); if (raw.length > 5_000_000) throw new Error("evidence_invalid: Evidence exceeds the 5 MB callback limit"); return Response.json(await acceptRunnerEvidence(token, raw), { status: 202 }); }
  catch (error) { return Response.json({ error: { code: "evidence_rejected", message: error instanceof Error ? error.message : "Evidence rejected", retriable: false, correlationId: crypto.randomUUID() } }, { status: 400 }); }
}
