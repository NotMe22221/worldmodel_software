import { completeComposioGithubConnection } from "@/db/composio";
import { requestIdentity } from "@/server/request-identity";

function dashboard(request: Request, status: string, correlationId: string) {
  const target = new URL("/dashboard", request.url);
  target.searchParams.set("tab", "integrations");
  target.searchParams.set("composio", status);
  target.searchParams.set("correlation", correlationId);
  return target;
}

function redirect(target: URL, correlationId: string) {
  return new Response(null, { status: 303, headers: { location: target.toString(), "x-correlation-id": correlationId } });
}

function routeLog(level: "info" | "warn", event: string, correlationId: string, details: Record<string, string> = {}) {
  const payload = JSON.stringify({ component: "composio_github_route", event, correlationId, ...details });
  if (level === "warn") console.warn(payload);
  else console.info(payload);
}

export async function GET(request: Request) {
  const correlationId = crypto.randomUUID();
  const email = await requestIdentity(request);
  const state = new URL(request.url).searchParams.get("state") || "";
  if (!/^[a-f0-9]{64}$/i.test(state)) {
    routeLog("warn", "callback_rejected", correlationId, { code: "INVALID_STATE" });
    return redirect(dashboard(request, "invalid_state", correlationId), correlationId);
  }
  try {
    routeLog("info", "callback_received", correlationId);
    await completeComposioGithubConnection(email, state, correlationId);
    routeLog("info", "callback_completed", correlationId);
    if (!email) return redirect(new URL(`/login?returnTo=${encodeURIComponent(`/dashboard?tab=integrations&composio=connected&correlation=${correlationId}`)}`, request.url), correlationId);
    return redirect(dashboard(request, "connected", correlationId), correlationId);
  } catch {
    routeLog("warn", "callback_failed", correlationId, { code: "COMPOSIO_CALLBACK_FAILED" });
    if (!email) return redirect(new URL(`/login?returnTo=${encodeURIComponent(`/dashboard?tab=integrations&composio=error&correlation=${correlationId}`)}`, request.url), correlationId);
    return redirect(dashboard(request, "error", correlationId), correlationId);
  }
}
