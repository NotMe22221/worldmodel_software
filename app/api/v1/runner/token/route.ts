import { exchangeRunnerOidc } from "@/server/github-oidc";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") || ""; const oidcToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  try { const body = await request.json() as { projectId?: string; runId?: string }; if (!oidcToken || !body.projectId || !body.runId) throw new Error("request_invalid: OIDC token, projectId, and runId are required"); return Response.json(await exchangeRunnerOidc({ oidcToken, audience: `${new URL(request.url).origin}/api/v1/runner/token`, projectId: body.projectId, runId: body.runId })); }
  catch (error) { return Response.json({ error: { code: "runner_token_rejected", message: error instanceof Error ? error.message : "Runner token rejected", retriable: false, correlationId: crypto.randomUUID() } }, { status: 403 }); }
}
