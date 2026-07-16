import { beginComposioGithubConnection, recoverComposioGithubConnection } from "@/db/composio";
import { requestIdentity } from "@/server/request-identity";
import { publicRequestOrigin } from "@/server/request-origin";

export async function GET(request: Request) {
  const correlationId = crypto.randomUUID();
  const email = await requestIdentity(request);
  if (!email) return Response.redirect(new URL(`/login?returnTo=${encodeURIComponent("/dashboard?tab=integrations")}`, request.url));
  try {
    const recovered = await recoverComposioGithubConnection(email);
    if (recovered) {
      const target = new URL("/dashboard", request.url);
      target.searchParams.set("tab", "integrations");
      target.searchParams.set("composio", "connected");
      return Response.redirect(target, 303);
    }
    const callbackUrl = new URL("/api/integrations/composio/github/callback", await publicRequestOrigin(request)).toString();
    const connection = await beginComposioGithubConnection(email, callbackUrl);
    return Response.redirect(connection.redirectUrl, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub connection could not start";
    const code = message.includes("not configured") ? "COMPOSIO_NOT_CONFIGURED" : "COMPOSIO_CONNECT_START_FAILED";
    if (!(request.headers.get("accept") || "").includes("application/json")) {
      const target = new URL("/dashboard", request.url);
      target.searchParams.set("tab", "integrations");
      target.searchParams.set("composio", "start_error");
      target.searchParams.set("correlation", correlationId);
      return Response.redirect(target, 303);
    }
    return Response.json({ error: { message, code, retriable: !message.includes("role"), correlationId } }, { status: message.includes("role") ? 403 : message.includes("not configured") ? 503 : 502, headers: { "x-correlation-id": correlationId } });
  }
}
