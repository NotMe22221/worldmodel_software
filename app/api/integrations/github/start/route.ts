import { beginGithubConnection } from "@/db/business";
import { githubConfiguration } from "@/server/runtime-config";
import { requestIdentity } from "@/server/request-identity";

export async function GET(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    const config = await githubConfiguration();
    const state = await beginGithubConnection(email);
    const target = new URL(`https://github.com/apps/${encodeURIComponent(config.appSlug)}/installations/new`);
    target.searchParams.set("state", state);
    return Response.redirect(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub connection could not start";
    return Response.json({ error: message }, { status: message.includes("role") ? 403 : message.includes("configured") ? 503 : 500 });
  }
}
