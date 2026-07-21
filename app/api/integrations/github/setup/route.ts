import { attachGithubInstallation } from "@/db/business";
import { githubConfiguration } from "@/server/runtime-config";
import { requestIdentity } from "@/server/request-identity";
import { publicRequestOrigin } from "@/server/request-origin";

export async function GET(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const installationId = url.searchParams.get("installation_id");
  if (!state || !installationId || !/^\d+$/.test(installationId)) return Response.json({ error: "GitHub returned an incomplete installation" }, { status: 400 });
  try {
    const origin = await publicRequestOrigin(request);
    const config = await githubConfiguration();
    await attachGithubInstallation(email, state, installationId);
    const authorization = new URL("https://github.com/login/oauth/authorize");
    authorization.searchParams.set("client_id", config.clientId);
    authorization.searchParams.set("state", state);
    authorization.searchParams.set("redirect_uri", new URL("/api/integrations/github/callback", origin).toString());
    return Response.redirect(authorization);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub installation could not be validated";
    return Response.json({ error: message }, { status: message.includes("state") ? 400 : message.includes("configured") ? 503 : 500 });
  }
}
