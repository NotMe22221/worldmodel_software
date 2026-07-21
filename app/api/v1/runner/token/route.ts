import { exchangeRunnerOidc } from "@/server/github-oidc";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/server/bounded-request-body";
import { publicRequestOrigin } from "@/server/request-origin";

const noStore = { "cache-control": "private, no-store", pragma: "no-cache" };

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const oidcToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  try {
    if (!oidcToken || oidcToken.length > 16_000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(oidcToken)) throw new Error("runner_unauthorized: A valid OIDC bearer token is required");
    const body = JSON.parse(await readBoundedRequestText(request, 4_096)) as { projectId?: string; runId?: string };
    if (!body.projectId || !body.runId) throw new Error("request_invalid: projectId and runId are required");
    const origin = await publicRequestOrigin(request);
    return Response.json(await exchangeRunnerOidc({ oidcToken, audience: `${origin}/api/v1/runner/token`, projectId: body.projectId, runId: body.runId }), { headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner token rejected";
    const verificationUnavailable = message.startsWith("runner_verification_unavailable:");
    const status = error instanceof RequestBodyTooLargeError ? 413 : message.startsWith("request_invalid:") || error instanceof SyntaxError ? 400 : verificationUnavailable || message.includes("not configured") || message.startsWith("oidc_unavailable:") ? 503 : 403;
    return Response.json({ error: { code: status === 413 ? "request_too_large" : status === 400 ? "request_invalid" : verificationUnavailable ? "runner_verification_unavailable" : "runner_token_rejected", message: status === 413 ? "Runner token request exceeds 4 KB" : message, retriable: status === 503, correlationId: crypto.randomUUID() } }, { status, headers: noStore });
  }
}
