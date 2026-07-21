import { beginComposioGithubConnection, recoverComposioGithubConnection } from "@/db/composio";
import { requestIdentity } from "@/server/request-identity";
import { publicRequestOrigin } from "@/server/request-origin";

function redirect(target: URL, correlationId: string, status = 303) {
  return new Response(null, { status, headers: { location: target.toString(), "x-correlation-id": correlationId, "cache-control": "private, no-store" } });
}

function startFailure(error: unknown) {
  const internalMessage = error instanceof Error ? error.message : "";
  if (internalMessage.includes("role")) return { code: "COMPOSIO_ROLE_REQUIRED", message: "Only workspace owners and admins can connect GitHub.", status: 403, retriable: false };
  if (internalMessage.includes("not configured")) return { code: "COMPOSIO_NOT_CONFIGURED", message: "GitHub connection is not configured for this deployment.", status: 503, retriable: false };
  return { code: "COMPOSIO_CONNECT_START_FAILED", message: "GitHub connection could not start. Retry, or share the correlation ID with support.", status: 502, retriable: true };
}

function routeLog(level: "info" | "warn", event: string, correlationId: string, details: Record<string, string | number | boolean> = {}) {
  const payload = JSON.stringify({ component: "composio_github_route", event, correlationId, ...details });
  if (level === "warn") console.warn(payload);
  else console.info(payload);
}

export async function GET(request: Request) {
  const correlationId = crypto.randomUUID();
  const email = await requestIdentity(request);
  let origin: string;
  try {
    origin = await publicRequestOrigin(request);
  } catch {
    routeLog("warn", "start_failed", correlationId, { code: "PUBLIC_ORIGIN_NOT_CONFIGURED", status: 503, retriable: false });
    return Response.json({ error: { message: "GitHub connection is not configured for this deployment.", code: "COMPOSIO_NOT_CONFIGURED", retriable: false, correlationId } }, { status: 503, headers: { "x-correlation-id": correlationId } });
  }
  if (!email) {
    routeLog("info", "start_auth_required", correlationId);
    return redirect(new URL(`/login?returnTo=${encodeURIComponent("/dashboard?tab=integrations")}`, origin), correlationId);
  }
  try {
    routeLog("info", "start_requested", correlationId);
    const recovered = await recoverComposioGithubConnection(email, correlationId);
    if (recovered) {
      const target = new URL("/dashboard", origin);
      target.searchParams.set("tab", "integrations");
      target.searchParams.set("composio", "connected");
      target.searchParams.set("correlation", correlationId);
      routeLog("info", "start_recovered", correlationId);
      return redirect(target, correlationId);
    }
    const callbackUrl = new URL("/api/integrations/composio/github/callback", origin).toString();
    const connection = await beginComposioGithubConnection(email, callbackUrl, correlationId);
    routeLog("info", "start_redirected", correlationId);
    return redirect(new URL(connection.redirectUrl), correlationId);
  } catch (error) {
    const failure = startFailure(error);
    routeLog("warn", "start_failed", correlationId, { code: failure.code, status: failure.status, retriable: failure.retriable });
    if (!(request.headers.get("accept") || "").includes("application/json")) {
      const target = new URL("/dashboard", origin);
      target.searchParams.set("tab", "integrations");
      target.searchParams.set("composio", "start_error");
      target.searchParams.set("correlation", correlationId);
      return redirect(target, correlationId);
    }
    return Response.json({ error: { message: failure.message, code: failure.code, retriable: failure.retriable, correlationId } }, { status: failure.status, headers: { "x-correlation-id": correlationId } });
  }
}
