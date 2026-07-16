import assert from "node:assert/strict";
import test from "node:test";

process.env.WORLDMODEL_LOCAL_RUNTIME = "true";
process.env.COMPOSIO_API_KEY = "ak_worldmodel_contract_fixture";
process.env.COMPOSIO_GITHUB_AUTH_CONFIG_ID = "ac_contract_github";
process.env.WORLDMODEL_PUBLIC_ORIGIN = "http://localhost:3100";

const COMMIT_SHA = "5f7d1f6d9b8ab313f29d73f6054f27a0d2d7e9b1";

function providerFetch() {
  let callbackUrl = "";
  let userId = "";
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: url.toString(), method: init.method || "GET", body, headers: init.headers });
    assert.equal(init.headers["x-api-key"], process.env.COMPOSIO_API_KEY);
    if (url.pathname.endsWith("/connected_accounts/link")) {
      callbackUrl = body.callback_url;
      userId = body.user_id;
      return Response.json({ link_token: "lt_contract", redirect_url: "https://connect.composio.dev/link/lt_contract", expires_at: new Date(Date.now() + 300_000).toISOString(), connected_account_id: "ca_contract" }, { status: 201 });
    }
    if (url.pathname.endsWith("/connected_accounts")) return Response.json({ items: [{ id: "ca_contract", user_id: userId, auth_config_id: "ac_contract_github", toolkit_slug: "github", status: "ACTIVE" }] });
    if (url.pathname.endsWith("/tools/execute/proxy")) {
      assert.equal(body.connected_account_id, "ca_contract");
      if (body.endpoint.endsWith(`/tarball/${COMMIT_SHA}`)) return Response.json({ status: 200, data: null, binary_data: { url: "https://downloads.example.test/repository.tar.gz?signature=fixture", content_type: "application/gzip", size: 4096, expires_at: new Date(Date.now() + 300_000).toISOString() } });
      if (body.endpoint.includes("/git/ref/heads/") && body.method === "GET") return Response.json({ status: 404, data: { message: "Not Found" } });
      if (body.endpoint.endsWith("/git/refs") && body.method === "POST") return Response.json({ status: 201, data: { ref: body.body.ref } });
      if (body.endpoint.includes("/contents/") && body.method === "GET") return Response.json({ status: 404, data: { message: "Not Found" } });
      if (body.endpoint.includes("/contents/") && body.method === "PUT") return Response.json({ status: 201, data: { content: { path: "src/repair.ts" } } });
      if (body.endpoint.includes("/pulls?") && body.method === "GET") return Response.json({ status: 200, data: [] });
      if (body.endpoint.endsWith("/pulls") && body.method === "POST") return Response.json({ status: 201, data: { number: 42, html_url: "https://github.com/octocat/Hello-World/pull/42", draft: true } });
      throw new Error(`Unexpected Composio proxy request: ${body.method} ${body.endpoint}`);
    }
    if (url.pathname.includes("/tools/execute/")) {
      assert.equal(body.connected_account_id, "ca_contract");
      assert.equal(body.user_id, userId);
      assert.equal(body.version, "latest");
      const tool = decodeURIComponent(url.pathname.split("/").pop());
      if (tool === "GITHUB_GET_THE_AUTHENTICATED_USER") return Response.json({ successful: true, data: { login: "contract-octocat" } });
      if (tool === "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER") return Response.json({ successful: true, data: { repositories: [{ id: 1296269, full_name: "octocat/Hello-World", default_branch: "master", private: false, html_url: "https://github.com/octocat/Hello-World" }, { id: "unsafe", full_name: "../../escape", default_branch: "main" }] } });
      if (tool === "GITHUB_GET_A_COMMIT") return Response.json({ successful: true, data: { sha: COMMIT_SHA } });
      if (tool === "GITHUB_GET_A_TREE") return Response.json({ successful: true, data: { sha: COMMIT_SHA, truncated: false, tree: [{ path: "package.json", type: "blob", size: 200 }, { path: "app/page.tsx", type: "blob", size: 400 }, { path: "app/api/health/route.ts", type: "blob", size: 120 }, { path: "db/schema.ts", type: "blob", size: 300 }, { path: "tests/checkout.spec.ts", type: "blob", size: 500 }] } });
    }
    throw new Error(`Unexpected Composio contract request: ${url}`);
  };
  return { fetch, calls, callback: () => callbackUrl };
}

test("Composio client creates a hosted link, verifies the account, filters repositories, and resolves an immutable tree", async () => {
  const originalFetch = globalThis.fetch;
  const provider = providerFetch();
  globalThis.fetch = provider.fetch;
  try {
    const { createComposioGithubLink, getComposioConnectedAccount, getComposioGithubArchiveUrl, getComposioGithubIdentity, getComposioGithubTree, listComposioGithubRepositories, publishComposioGithubDraftFiles } = await import("../server/composio.ts");
    const composioUserId = `wm_${"a".repeat(40)}`;
    const started = await createComposioGithubLink(composioUserId, "http://127.0.0.1:3100/api/integrations/composio/github/callback?state=secure-state");
    assert.equal(started.redirectUrl, "https://connect.composio.dev/link/lt_contract");
    const linkRequest = provider.calls.find((call) => call.url.endsWith("/connected_accounts/link"));
    assert.equal("alias" in linkRequest.body, false, "reconnects must not collide on a reusable provider alias");
    assert.equal(new URL(provider.callback()).searchParams.get("state"), "secure-state");
    const account = await getComposioConnectedAccount("ca_contract");
    assert.equal(account.userId, composioUserId);
    assert.equal(account.toolkitSlug, "github");
    assert.equal((await getComposioGithubIdentity(account.id, account.userId)).login, "contract-octocat");
    const repositories = await listComposioGithubRepositories(account.id, account.userId);
    assert.equal(repositories.length, 1, "unsafe repository names are discarded");
    const tree = await getComposioGithubTree(account.id, account.userId, repositories[0].fullName, repositories[0].defaultBranch);
    assert.equal(tree.commitSha, COMMIT_SHA);
    assert.ok(tree.entries.some((entry) => entry.path === "app/page.tsx"));
    const archive = await getComposioGithubArchiveUrl(account.id, repositories[0].fullName, tree.commitSha);
    assert.match(archive.url, /^https:\/\/downloads\.example\.test\//);
    assert.equal(archive.size, 4096);
    const published = await publishComposioGithubDraftFiles({ connectedAccountId: account.id, owner: "octocat", repository: "Hello-World", baseBranch: "master", baseSha: tree.commitSha, headBranch: "worldmodel/report-contract", title: "draft: verified repair", body: "Fixture verification report", files: [{ path: "src/repair.ts", content: "export const repaired = true;\n" }] });
    assert.deepEqual(published, { number: 42, html_url: "https://github.com/octocat/Hello-World/pull/42", draft: true });
    const fileWrite = provider.calls.find((call) => call.body?.method === "PUT" && call.body?.endpoint?.includes("/contents/src/repair.ts"));
    assert.equal(Buffer.from(fileWrite.body.body.content, "base64").toString("utf8"), "export const repaired = true;\n");
    assert.ok(provider.calls.some((call) => call.body?.method === "POST" && call.body?.endpoint?.endsWith("/pulls") && call.body?.body?.draft === true));
    assert.ok(provider.calls.some((call) => call.url.endsWith("GITHUB_GET_A_COMMIT")));
    assert.ok(provider.calls.some((call) => call.url.endsWith("GITHUB_GET_A_TREE")));
  } finally { globalThis.fetch = originalFetch; }
});

test("local OAuth callbacks preserve the browser host so host-only sessions survive", async () => {
  const { publicRequestOrigin } = await import("../server/request-origin.ts");
  assert.equal(await publicRequestOrigin(new Request("http://127.0.0.1:3100/api/integrations/composio/github/start")), "http://127.0.0.1:3100");
  assert.equal(await publicRequestOrigin(new Request("http://localhost:3100/api/integrations/composio/github/start")), "http://localhost:3100");
});

test("Composio rejects a redirect URL outside the hosted Connect origin", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ link_token: "lt_bad", redirect_url: "https://attacker.example/connect", expires_at: new Date(Date.now() + 60_000).toISOString(), connected_account_id: "ca_bad" }, { status: 201 });
  try {
    const { createComposioGithubLink } = await import("../server/composio.ts");
    await assert.rejects(() => createComposioGithubLink(`wm_${"a".repeat(40)}`, "http://127.0.0.1:3100/api/integrations/composio/github/callback"), /untrusted connection URL/);
  } finally { globalThis.fetch = originalFetch; }
});
