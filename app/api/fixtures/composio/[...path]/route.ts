import { getRuntimeEnv, isLocalDevelopmentEnvironment } from "@/server/runtime-env";

type Context = { params: Promise<{ path: string[] }> };
type JsonRecord = Record<string, unknown>;
const FIXTURE_SHA = "5f7d1f6d9b8ab313f29d73f6054f27a0d2d7e9b1";

async function fixtureMode() {
  const env = await getRuntimeEnv();
  return isLocalDevelopmentEnvironment(env) && env.COMPOSIO_FIXTURE_MODE === "true";
}

async function enabled(request: Request) {
  return await fixtureMode() && request.headers.get("x-api-key") === "fixture";
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function sameLocalOrigin(left: URL, right: URL) {
  return left.protocol === "http:" && right.protocol === "http:" && left.port === right.port && ["127.0.0.1", "localhost"].includes(left.hostname) && ["127.0.0.1", "localhost"].includes(right.hostname);
}

function fixtureAccount(id: string) {
  const userId = id.replace(/^ca_fixture_/, "");
  return { id, connected_account_id: id, user_id: userId, auth_config_id: "ac_fixture_github", toolkit_slug: "github", status: "ACTIVE" };
}

export async function GET(request: Request, context: Context) {
  const { path } = await context.params;
  if (path.join("/") === "connect") {
    if (!(await fixtureMode())) return jsonError("Fixture provider is disabled", 404);
    const target = new URL(request.url).searchParams.get("callback_url");
    if (!target) return jsonError("Missing fixture callback", 400);
    const callback = new URL(target);
    const origin = new URL(request.url).origin;
    if (!sameLocalOrigin(callback, new URL(origin)) || callback.pathname !== "/api/integrations/composio/github/callback") return jsonError("Untrusted fixture callback", 400);
    return Response.redirect(callback, 303);
  }
  if (!(await enabled(request))) return jsonError("Fixture provider is disabled", 404);
  if (path.join("/") === "api/v3.1/connected_accounts") {
    const id = new URL(request.url).searchParams.get("connected_account_ids") || "";
    if (!/^ca_fixture_wm_[a-f0-9]{40}$/.test(id)) return Response.json({ items: [] });
    return Response.json({ items: [fixtureAccount(id)] });
  }
  return jsonError("Unknown fixture route", 404);
}

export async function POST(request: Request, context: Context) {
  if (!(await enabled(request))) return jsonError("Fixture provider is disabled", 404);
  const { path } = await context.params;
  const route = path.join("/");
  const body = record(await request.json().catch(() => null));
  if (route === "api/v3.1/connected_accounts/link") {
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    const callbackUrl = typeof body.callback_url === "string" ? body.callback_url : "";
    const authConfigId = typeof body.auth_config_id === "string" ? body.auth_config_id : "";
    if (!/^wm_[a-f0-9]{40}$/.test(userId) || authConfigId !== "ac_fixture_github") return jsonError("Invalid fixture link request", 400);
    const callback = new URL(callbackUrl);
    if (!sameLocalOrigin(callback, new URL(request.url)) || callback.pathname !== "/api/integrations/composio/github/callback") return jsonError("Invalid fixture callback", 400);
    const redirect = new URL("/api/fixtures/composio/connect", callback);
    redirect.searchParams.set("callback_url", callback.toString());
    return Response.json({ link_token: `lt_fixture_${userId}`, redirect_url: redirect.toString(), expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), connected_account_id: `ca_fixture_${userId}` }, { status: 201 });
  }
  const toolPrefix = "api/v3.1/tools/execute/";
  if (route.startsWith(toolPrefix)) {
    const tool = decodeURIComponent(route.slice(toolPrefix.length));
    const connectedAccountId = typeof body.connected_account_id === "string" ? body.connected_account_id : "";
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    if (connectedAccountId !== `ca_fixture_${userId}` || !/^wm_[a-f0-9]{40}$/.test(userId)) return jsonError("Fixture account mismatch", 403);
    if (tool === "GITHUB_GET_THE_AUTHENTICATED_USER") return Response.json({ successful: true, data: { login: "worldmodel-fixture" }, error: null, log_id: "fixture_identity" });
    if (tool === "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER") return Response.json({ successful: true, data: { repositories: [{ id: 1296269, full_name: "octocat/Hello-World", default_branch: "master", private: false, html_url: "https://github.com/octocat/Hello-World" }] }, error: null, log_id: "fixture_repositories" });
    if (tool === "GITHUB_GET_A_COMMIT") return Response.json({ successful: true, data: { sha: FIXTURE_SHA, commit: { message: "Deterministic WorldModel fixture commit" } }, error: null, log_id: "fixture_commit" });
    if (tool === "GITHUB_GET_A_TREE") return Response.json({ successful: true, data: { sha: FIXTURE_SHA, truncated: false, tree: [
      { path: "package.json", type: "blob", size: 480 },
      { path: "app", type: "tree" },
      { path: "app/page.tsx", type: "blob", size: 820 },
      { path: "app/api/health/route.ts", type: "blob", size: 170 },
      { path: "server/checkout.ts", type: "blob", size: 940 },
      { path: "db/schema.ts", type: "blob", size: 760 },
      { path: "tests/checkout.spec.ts", type: "blob", size: 1180 },
      { path: "playwright.config.ts", type: "blob", size: 420 }
    ] }, error: null, log_id: "fixture_tree" });
    return jsonError("Unknown fixture GitHub tool", 404);
  }
  if (/^api\/v3\.1\/connected_accounts\/[^/]+\/revoke$/.test(route)) return Response.json({ success: true });
  return jsonError("Unknown fixture route", 404);
}
