import { completeGithubConnection, pendingGithubConnection } from "@/db/business";
import { accessibleInstallations, authorizedInstallation, exchangeGithubCode, installationRepositories } from "@/server/github";
import { requestIdentity } from "@/server/request-identity";
import { publicRequestOrigin } from "@/server/request-origin";

function dashboard(origin: string, result: string) {
  return new URL(`/dashboard?integration=${encodeURIComponent(result)}`, origin);
}

export async function GET(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  try {
    const origin = await publicRequestOrigin(request);
    if (!code || !state) return Response.redirect(dashboard(origin, "github_canceled"));
    const pending = await pendingGithubConnection(email, state);
    const redirectUri = new URL("/api/integrations/github/callback", origin).toString();
    const userToken = await exchangeGithubCode(code, redirectUri);
    const installations = await accessibleInstallations(userToken);
    const installation = authorizedInstallation(installations, String(pending.installation_id));
    if (!installation) throw new Error("The authorized GitHub user cannot access this installation");
    const repositories = await installationRepositories(String(installation.id));
    await completeGithubConnection(email, state, installation, repositories);
    return Response.redirect(dashboard(origin, "github_connected"));
  } catch {
    try {
      return Response.redirect(dashboard(await publicRequestOrigin(request), "github_error"));
    } catch {
      return Response.json({ error: "GitHub callback origin is not configured" }, { status: 503 });
    }
  }
}
