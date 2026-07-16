import { completeComposioGithubConnection } from "@/db/composio";
import { requestIdentity } from "@/server/request-identity";

function dashboard(request: Request, status: string) {
  const target = new URL("/dashboard", request.url);
  target.searchParams.set("tab", "integrations");
  target.searchParams.set("composio", status);
  return target;
}

export async function GET(request: Request) {
  const email = await requestIdentity(request);
  const state = new URL(request.url).searchParams.get("state") || "";
  if (!/^[a-f0-9]{64}$/i.test(state)) return Response.redirect(dashboard(request, "invalid_state"), 303);
  try {
    await completeComposioGithubConnection(email, state);
    if (!email) return Response.redirect(new URL(`/login?returnTo=${encodeURIComponent("/dashboard?tab=integrations&composio=connected")}`, request.url), 303);
    return Response.redirect(dashboard(request, "connected"), 303);
  } catch {
    if (!email) return Response.redirect(new URL(`/login?returnTo=${encodeURIComponent("/dashboard?tab=integrations&composio=error")}`, request.url), 303);
    return Response.redirect(dashboard(request, "error"), 303);
  }
}
