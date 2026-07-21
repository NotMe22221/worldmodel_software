import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

process.env.WORLDMODEL_LOCAL_RUNTIME = "true";
process.env.COMPOSIO_API_KEY = "ak_worldmodel_contract_fixture";
process.env.COMPOSIO_GITHUB_AUTH_CONFIG_ID = "ac_contract_github";
process.env.WORLDMODEL_PUBLIC_ORIGIN = "http://localhost:3100";

const COMMIT_SHA = "5f7d1f6d9b8ab313f29d73f6054f27a0d2d7e9b1";
const BASE_TREE_SHA = "b".repeat(40);
const BLOB_SHA = "c".repeat(40);
const CANDIDATE_TREE_SHA = "d".repeat(40);
const CANDIDATE_COMMIT_SHA = "e".repeat(40);

function draftPull(number = 42, headSha = CANDIDATE_COMMIT_SHA) {
  return {
    number,
    html_url: `https://github.com/octocat/Hello-World/pull/${number}`,
    draft: true,
    state: "open",
    merged_at: null,
    head: { ref: "worldmodel/report-contract-fresh-1234567890", sha: headSha, repo: { full_name: "octocat/Hello-World" } },
    base: { ref: "master", repo: { full_name: "octocat/Hello-World" } },
  };
}
const EXPECTED_WORKFLOW = "name: WorldModel verified runner\n";

function attemptDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE composio_connection_attempts (state_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_by TEXT NOT NULL, composio_user_id TEXT NOT NULL, connected_account_id TEXT, auth_config_id TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const statement = (sql, values = []) => ({
    bind: (...nextValues) => statement(sql, nextValues),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => {
      const result = sqlite.prepare(sql).run(...values);
      return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    },
  });
  return { prepare: (sql) => statement(sql), batch: async () => [] };
}

function providerFetch() {
  let callbackUrl = "";
  let userId = "";
  const calls = [];
  const refs = new Map();
  const pullRequests = new Map();
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
      if (body.endpoint.includes("/.github/workflows/worldmodel-proj_verified.yml") && body.method === "GET") return Response.json({ status: 200, data: { type: "file", encoding: "base64", content: Buffer.from(EXPECTED_WORKFLOW).toString("base64"), size: Buffer.byteLength(EXPECTED_WORKFLOW) } });
      if (body.endpoint.endsWith(`/git/commits/${COMMIT_SHA}`) && body.method === "GET") return Response.json({ status: 200, data: { sha: COMMIT_SHA, tree: { sha: BASE_TREE_SHA } } });
      if (body.endpoint.endsWith(`/git/commits/${CANDIDATE_COMMIT_SHA}`) && body.method === "GET") return Response.json({ status: 200, data: { sha: CANDIDATE_COMMIT_SHA, tree: { sha: CANDIDATE_TREE_SHA }, parents: [{ sha: COMMIT_SHA }] } });
      if (body.endpoint.endsWith("/git/blobs") && body.method === "POST") return Response.json({ status: 201, data: { sha: BLOB_SHA } });
      if (body.endpoint.endsWith("/git/trees") && body.method === "POST") return Response.json({ status: 201, data: { sha: CANDIDATE_TREE_SHA } });
      if (body.endpoint.endsWith("/git/commits") && body.method === "POST") return Response.json({ status: 201, data: { sha: CANDIDATE_COMMIT_SHA } });
      if (body.endpoint.includes("/git/ref/heads/") && body.method === "GET") {
        const branch = body.endpoint.split("/git/ref/heads/")[1];
        const sha = refs.get(branch);
        return sha ? Response.json({ status: 200, data: { object: { sha } } }) : Response.json({ status: 404, data: { message: "Not Found" } });
      }
      if (body.endpoint.endsWith("/git/refs") && body.method === "POST") {
        const branch = String(body.body.ref).replace(/^refs\/heads\//, "");
        if (refs.has(branch)) return Response.json({ status: 422, data: { message: "Reference already exists" } });
        refs.set(branch, body.body.sha);
        return Response.json({ status: 201, data: { ref: body.body.ref } });
      }
      if (body.endpoint.includes("/contents/") && body.method === "GET") return Response.json({ status: 404, data: { message: "Not Found" } });
      if (body.endpoint.includes("/contents/") && body.method === "PUT") return Response.json({ status: 201, data: { content: { path: "src/repair.ts" } } });
      if (body.endpoint.includes("/pulls?") && body.method === "GET") {
        const query = new URL(body.endpoint);
        const requestedHead = query.searchParams.get("head") || "";
        const branch = requestedHead.includes(":") ? requestedHead.slice(requestedHead.indexOf(":") + 1) : requestedHead;
        const existing = pullRequests.get(`${branch}|${query.searchParams.get("base") || ""}`);
        return Response.json({ status: 200, data: existing ? [existing] : [] });
      }
      if (body.endpoint.endsWith("/pulls") && body.method === "POST") {
        const key = `${body.body.head}|${body.body.base}`;
        if (pullRequests.has(key)) return Response.json({ status: 422, data: { message: "A pull request already exists" } });
        const created = draftPull();
        pullRequests.set(key, created);
        return Response.json({ status: 201, data: created });
      }
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
    const { createComposioGithubLink, getComposioConnectedAccount, getComposioGithubArchiveUrl, getComposioGithubFileAtCommit, getComposioGithubIdentity, getComposioGithubTree, listComposioGithubRepositories, publishComposioGithubDraftFiles } = await import("../server/composio.ts");
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
    assert.equal(await getComposioGithubFileAtCommit(account.id, repositories[0].fullName, ".github/workflows/worldmodel-proj_verified.yml", tree.commitSha), EXPECTED_WORKFLOW);
    const published = await publishComposioGithubDraftFiles({ connectedAccountId: account.id, owner: "octocat", repository: "Hello-World", baseBranch: "master", baseSha: tree.commitSha, headBranch: "worldmodel/report-contract", title: "draft: verified repair", body: "Fixture verification report", files: [{ path: "src/repair.ts", content: "export const repaired = true;\n" }] });
    assert.deepEqual(published, { number: 42, html_url: "https://github.com/octocat/Hello-World/pull/42", draft: true });
    const fileWrite = provider.calls.find((call) => call.body?.method === "PUT" && call.body?.endpoint?.includes("/contents/src/repair.ts"));
    assert.equal(Buffer.from(fileWrite.body.body.content, "base64").toString("utf8"), "export const repaired = true;\n");
    assert.ok(provider.calls.some((call) => call.body?.method === "POST" && call.body?.endpoint?.endsWith("/pulls") && call.body?.body?.draft === true));
    assert.ok(provider.calls.some((call) => call.url.endsWith("GITHUB_GET_A_COMMIT")));
    assert.ok(provider.calls.some((call) => call.url.endsWith("GITHUB_GET_A_TREE")));

    const freshCallsStart = provider.calls.length;
    const freshPublished = await publishComposioGithubDraftFiles({ connectedAccountId: account.id, owner: "octocat", repository: "Hello-World", baseBranch: "master", baseSha: tree.commitSha, headBranch: "worldmodel/report-contract-fresh-1234567890", title: "draft: verified repair", body: "Fixture verification report", files: [{ path: "src/repair.ts", content: "export const repaired = true;\n" }], freshBranchFromBase: true });
    assert.deepEqual(freshPublished, { number: 42, html_url: "https://github.com/octocat/Hello-World/pull/42", draft: true });
    const freshCalls = provider.calls.slice(freshCallsStart).map((call) => call.body).filter((body) => body?.endpoint);
    assert.equal(freshCalls.some((body) => body.method === "GET" && body.endpoint.includes("/git/ref/heads/")), true);
    assert.equal(freshCalls.some((body) => body.endpoint.includes("/contents/src/repair.ts")), false);
    const freshTree = freshCalls.find((body) => body.method === "POST" && body.endpoint.endsWith("/git/trees"));
    assert.equal(freshTree.body.base_tree, BASE_TREE_SHA);
    assert.deepEqual(freshTree.body.tree, [{ path: "src/repair.ts", mode: "100644", type: "blob", sha: BLOB_SHA }]);
    const freshCommit = freshCalls.find((body) => body.method === "POST" && body.endpoint.endsWith("/git/commits"));
    assert.equal(freshCommit.body.tree, CANDIDATE_TREE_SHA);
    assert.deepEqual(freshCommit.body.parents, [COMMIT_SHA]);
    const freshRef = freshCalls.find((body) => body.method === "POST" && body.endpoint.endsWith("/git/refs"));
    assert.equal(freshRef.body.sha, CANDIDATE_COMMIT_SHA);
    assert.equal(freshRef.body.ref, "refs/heads/worldmodel/report-contract-fresh-1234567890");
    assert.ok(freshCalls.some((body) => body.method === "GET" && body.endpoint.includes("/pulls?state=all")));

    const freshRetryCallsStart = provider.calls.length;
    const freshRetry = await publishComposioGithubDraftFiles({ connectedAccountId: account.id, owner: "octocat", repository: "Hello-World", baseBranch: "master", baseSha: tree.commitSha, headBranch: "worldmodel/report-contract-fresh-1234567890", title: "draft: verified repair", body: "Fixture verification report", files: [{ path: "src/repair.ts", content: "export const repaired = true;\n" }], freshBranchFromBase: true });
    assert.deepEqual(freshRetry, freshPublished);
    const freshRetryCalls = provider.calls.slice(freshRetryCallsStart).map((call) => call.body).filter((body) => body?.endpoint);
    assert.ok(freshRetryCalls.some((body) => body.method === "GET" && body.endpoint.endsWith(`/git/commits/${CANDIDATE_COMMIT_SHA}`)));
    assert.ok(freshRetryCalls.some((body) => body.method === "GET" && body.endpoint.includes("/pulls?")));
    assert.equal(freshRetryCalls.some((body) => body.method === "POST" && body.endpoint.endsWith("/git/commits")), false);
    assert.equal(freshRetryCalls.some((body) => body.method === "POST" && body.endpoint.endsWith("/git/refs")), false);
    assert.equal(freshRetryCalls.some((body) => body.method === "POST" && body.endpoint.endsWith("/pulls")), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("Composio creates and uses managed GitHub auth when no config ID override exists", async () => {
  const originalFetch = globalThis.fetch;
  const originalAuthConfigId = process.env.COMPOSIO_GITHUB_AUTH_CONFIG_ID;
  const runtimeEnv = globalThis.__worldmodelLocalEnv;
  const originalRuntimeAuthConfigId = runtimeEnv?.COMPOSIO_GITHUB_AUTH_CONFIG_ID;
  const calls = [];
  delete process.env.COMPOSIO_GITHUB_AUTH_CONFIG_ID;
  if (runtimeEnv) delete runtimeEnv.COMPOSIO_GITHUB_AUTH_CONFIG_ID;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, method: init.method || "GET", body });
    if (url.pathname.endsWith("/auth_configs") && !init.method) return Response.json({ items: [] });
    if (url.pathname.endsWith("/auth_configs") && init.method === "POST") {
      assert.deepEqual(body, { toolkit: { slug: "github" } });
      return Response.json({ toolkit: { slug: "github" }, auth_config: { id: "ac_managed_github", is_composio_managed: true } }, { status: 201 });
    }
    if (url.pathname.endsWith("/connected_accounts/link")) {
      assert.equal(body.auth_config_id, "ac_managed_github");
      return Response.json({ link_token: "lt_managed", redirect_url: "https://connect.composio.dev/link/lt_managed", connected_account_id: "ca_managed" }, { status: 201 });
    }
    throw new Error(`Unexpected managed auth request: ${url}`);
  };
  try {
    const { createComposioGithubLink } = await import("../server/composio.ts");
    const link = await createComposioGithubLink(`wm_${"f".repeat(40)}`, "http://localhost:3100/api/integrations/composio/github/callback");
    assert.equal(link.authConfigId, "ac_managed_github");
    assert.equal(link.redirectUrl, "https://connect.composio.dev/link/lt_managed");
    assert.equal(calls[0].url.searchParams.get("toolkit_slug"), "github");
    assert.equal(calls[0].url.searchParams.get("is_composio_managed"), "true");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAuthConfigId === undefined) delete process.env.COMPOSIO_GITHUB_AUTH_CONFIG_ID;
    else process.env.COMPOSIO_GITHUB_AUTH_CONFIG_ID = originalAuthConfigId;
    if (runtimeEnv) {
      if (originalRuntimeAuthConfigId === undefined) delete runtimeEnv.COMPOSIO_GITHUB_AUTH_CONFIG_ID;
      else runtimeEnv.COMPOSIO_GITHUB_AUTH_CONFIG_ID = originalRuntimeAuthConfigId;
    }
  }
});

test("Composio fresh draft retries reject an existing branch with a different generated tree", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    assert.equal(init.headers["x-api-key"], process.env.COMPOSIO_API_KEY);
    assert.equal(body.connected_account_id, "ca_contract");
    if (body.endpoint.endsWith(`/git/commits/${COMMIT_SHA}`) && body.method === "GET") return Response.json({ status: 200, data: { sha: COMMIT_SHA, tree: { sha: BASE_TREE_SHA } } });
    if (body.endpoint.endsWith("/git/blobs") && body.method === "POST") return Response.json({ status: 201, data: { sha: BLOB_SHA } });
    if (body.endpoint.endsWith("/git/trees") && body.method === "POST") return Response.json({ status: 201, data: { sha: CANDIDATE_TREE_SHA } });
    if (body.endpoint.includes("/git/ref/heads/worldmodel/") && body.method === "GET") return Response.json({ status: 200, data: { object: { sha: CANDIDATE_COMMIT_SHA } } });
    if (body.endpoint.endsWith(`/git/commits/${CANDIDATE_COMMIT_SHA}`) && body.method === "GET") return Response.json({ status: 200, data: { sha: CANDIDATE_COMMIT_SHA, tree: { sha: "1".repeat(40) }, parents: [{ sha: COMMIT_SHA }] } });
    throw new Error(`Unexpected Composio conflict request: ${body.method} ${body.endpoint}`);
  };
  try {
    const { publishComposioGithubDraftFiles } = await import("../server/composio.ts");
    await assert.rejects(
      publishComposioGithubDraftFiles({ connectedAccountId: "ca_contract", owner: "octocat", repository: "Hello-World", baseBranch: "master", baseSha: COMMIT_SHA, headBranch: "worldmodel/report-contract-fresh-1234567890", title: "draft: verified repair", body: "Fixture verification report", files: [{ path: "src/repair.ts", content: "export const repaired = true;\n" }], freshBranchFromBase: true }),
      /draft branch conflicts with the approved repair candidate/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Composio fresh draft retries reject a closed or merged historical pull request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (body.endpoint.endsWith(`/git/commits/${COMMIT_SHA}`) && body.method === "GET") return Response.json({ status: 200, data: { sha: COMMIT_SHA, tree: { sha: BASE_TREE_SHA } } });
    if (body.endpoint.endsWith("/git/blobs") && body.method === "POST") return Response.json({ status: 201, data: { sha: BLOB_SHA } });
    if (body.endpoint.endsWith("/git/trees") && body.method === "POST") return Response.json({ status: 201, data: { sha: CANDIDATE_TREE_SHA } });
    if (body.endpoint.includes("/git/ref/heads/worldmodel/") && body.method === "GET") return Response.json({ status: 200, data: { object: { sha: CANDIDATE_COMMIT_SHA } } });
    if (body.endpoint.endsWith(`/git/commits/${CANDIDATE_COMMIT_SHA}`) && body.method === "GET") return Response.json({ status: 200, data: { sha: CANDIDATE_COMMIT_SHA, tree: { sha: CANDIDATE_TREE_SHA }, parents: [{ sha: COMMIT_SHA }] } });
    if (body.endpoint.includes("/pulls?") && body.method === "GET") return Response.json({ status: 200, data: [{ ...draftPull(), state: "closed", merged_at: "2026-01-01T00:00:00Z" }] });
    throw new Error(`Unexpected Composio closed-pull request: ${body.method} ${body.endpoint}`);
  };
  try {
    const { publishComposioGithubDraftFiles } = await import("../server/composio.ts");
    await assert.rejects(
      publishComposioGithubDraftFiles({ connectedAccountId: "ca_contract", owner: "octocat", repository: "Hello-World", baseBranch: "master", baseSha: COMMIT_SHA, headBranch: "worldmodel/report-contract-fresh-1234567890", title: "draft: verified repair", body: "Fixture verification report", files: [{ path: "src/repair.ts", content: "export const repaired = true;\n" }], freshBranchFromBase: true }),
      /not an open draft at the verified branch head/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local OAuth callbacks preserve the browser host so host-only sessions survive", async () => {
  const { publicRequestOrigin } = await import("../server/request-origin.ts");
  assert.equal(await publicRequestOrigin(new Request("http://127.0.0.1:3100/api/integrations/composio/github/start")), "http://127.0.0.1:3100");
  assert.equal(await publicRequestOrigin(new Request("http://localhost:3100/api/integrations/composio/github/start")), "http://localhost:3100");
});

test("production OAuth callbacks use Vercel's stable project URL instead of a request-derived host", async () => {
  const { resolvePublicRequestOrigin } = await import("../server/request-origin.ts");
  const request = new Request("https://untrusted-request-host.example/api/integrations/composio/github/start");
  assert.equal(resolvePublicRequestOrigin(request, {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_PRODUCTION_URL: "worldmodel-software.vercel.app",
  }), "https://worldmodel-software.vercel.app");
  assert.equal(resolvePublicRequestOrigin(request, {
    VERCEL_RUNTIME: "true",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_PRODUCTION_URL: "worldmodel-software.vercel.app",
    WORLDMODEL_PUBLIC_ORIGIN: "https://worldmodel.example",
  }), "https://worldmodel.example");
});

test("preview OAuth callbacks use the unique Vercel deployment URL", async () => {
  const { resolvePublicRequestOrigin } = await import("../server/request-origin.ts");
  const request = new Request("https://untrusted-request-host.example/api/integrations/composio/github/start");
  assert.equal(resolvePublicRequestOrigin(request, {
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_URL: "worldmodel-git-fix-example.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "worldmodel-software.vercel.app",
  }), "https://worldmodel-git-fix-example.vercel.app");
});

test("Vercel callbacks fail closed without a system URL and reject non-origin values", async () => {
  const { resolvePublicRequestOrigin, vercelProjectProductionOrigin } = await import("../server/request-origin.ts");
  const request = new Request("https://untrusted-request-host.example/api/integrations/composio/github/start");
  assert.throws(() => resolvePublicRequestOrigin(request, { VERCEL: "1", VERCEL_ENV: "production" }), /not configured/);
  assert.throws(() => resolvePublicRequestOrigin(request, { VERCEL: "1", VERCEL_ENV: "preview" }), /not configured/);
  assert.throws(() => resolvePublicRequestOrigin(request, { VERCEL_RUNTIME: "true" }), /not configured/);
  assert.throws(() => vercelProjectProductionOrigin("https://user:secret@example.com"), /not allowed/);
  assert.throws(() => vercelProjectProductionOrigin("example.com/oauth/callback"), /not allowed/);
});

test("Composio rejects a redirect URL outside the hosted Connect origin", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ link_token: "lt_bad", redirect_url: "https://attacker.example/connect", expires_at: new Date(Date.now() + 60_000).toISOString(), connected_account_id: "ca_bad" }, { status: 201 });
  try {
    const { createComposioGithubLink } = await import("../server/composio.ts");
    await assert.rejects(() => createComposioGithubLink(`wm_${"a".repeat(40)}`, "http://127.0.0.1:3100/api/integrations/composio/github/callback"), /untrusted connection URL/);
  } finally { globalThis.fetch = originalFetch; }
});

test("Composio provider requests use a bounded deadline and return a safe timeout error", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  let receivedSignal;
  try {
    AbortSignal.timeout = () => AbortSignal.abort(new DOMException("fixture deadline", "TimeoutError"));
    globalThis.fetch = async (_url, init = {}) => {
      receivedSignal = init.signal;
      throw receivedSignal.reason;
    };
    const { createComposioGithubLink } = await import("../server/composio.ts");
    await assert.rejects(
      createComposioGithubLink(`wm_${"a".repeat(40)}`, "http://127.0.0.1:3100/api/integrations/composio/github/callback"),
      { message: "Composio request timed out" },
    );
    assert.equal(receivedSignal.aborted, true);
  } finally {
    AbortSignal.timeout = originalTimeout;
    globalThis.fetch = originalFetch;
  }
});

test("provider settings are editable only in the explicitly local environment", async () => {
  const { providerSettingsModeForEnvironment } = await import("../server/provider-settings.ts");
  assert.deepEqual(providerSettingsModeForEnvironment({ LOCAL_DEVELOPMENT: "true" }), { editable: true, source: "local_encrypted_store" });
  assert.deepEqual(providerSettingsModeForEnvironment({ VERCEL: "1" }), { editable: false, source: "deployment_environment" });
  assert.deepEqual(providerSettingsModeForEnvironment({ VERCEL: "1", VERCEL_RUNTIME: "true", LOCAL_DEVELOPMENT: "true" }), { editable: false, source: "deployment_environment" });
});

test("Composio readiness reports exact missing variable names without exposing values", async () => {
  const { composioConfigurationStatusForEnvironment } = await import("../server/runtime-config.ts");
  assert.deepEqual(composioConfigurationStatusForEnvironment({ VERCEL: "1" }), {
    configured: false,
    githubConfigured: false,
    fixture: false,
    missing: ["COMPOSIO_API_KEY"],
  });
  assert.deepEqual(composioConfigurationStatusForEnvironment({ VERCEL: "1", COMPOSIO_API_KEY: "secret" }), {
    configured: true,
    githubConfigured: true,
    fixture: false,
    missing: [],
  });
  assert.deepEqual(composioConfigurationStatusForEnvironment({
    VERCEL: "1",
    COMPOSIO_API_KEY: "secret",
    COMPOSIO_GITHUB_AUTH_CONFIG_ID: "ac_github",
  }), {
    configured: true,
    githubConfigured: true,
    fixture: false,
    missing: [],
  });
});

test("a transient callback can release its claim, retry, and consume the OAuth attempt exactly once", async () => {
  const db = attemptDatabase();
  const stateHash = "a".repeat(64);
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO composio_connection_attempts (state_hash, workspace_id, created_by, composio_user_id, connected_account_id, auth_config_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(stateHash, "ws_retry", "owner@example.com", `wm_${"b".repeat(40)}`, "ca_retry", "ac_contract_github", new Date(Date.now() + 300_000).toISOString()).run();
  const { claimComposioConnectionAttempt, finalizeComposioConnectionAttempt, getComposioConnectionAttempt, releaseComposioConnectionAttempt } = await import("../server/composio-attempts.ts");

  const firstClaim = await claimComposioConnectionAttempt(db, stateHash, now, "corr-transient");
  assert.match(firstClaim, /^processing:/);
  assert.equal(await releaseComposioConnectionAttempt(db, stateHash, firstClaim, new Date().toISOString()), true);
  assert.equal((await getComposioConnectionAttempt(db, stateHash)).used_at, null, "a transient provider failure must not burn the one-time state");

  const retryClaim = await claimComposioConnectionAttempt(db, stateHash, new Date().toISOString(), "corr-success");
  assert.match(retryClaim, /^processing:/);
  assert.equal(await finalizeComposioConnectionAttempt(db, stateHash, retryClaim), true);
  assert.ok((await getComposioConnectionAttempt(db, stateHash)).used_at);
  assert.equal(await claimComposioConnectionAttempt(db, stateHash, new Date().toISOString(), "corr-replay"), null, "a replay must not acquire the consumed state");
});

test("recovery cleans expired attempts and returns only the newest unexpired account", async () => {
  const db = attemptDatabase();
  const email = "owner@example.com";
  const userId = `wm_${"c".repeat(40)}`;
  const authConfigId = "ac_contract_github";
  const insert = "INSERT INTO composio_connection_attempts (state_hash, workspace_id, created_by, composio_user_id, connected_account_id, auth_config_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
  await db.prepare(insert).bind("1".repeat(64), "ws_recovery", email, userId, "ca_old", authConfigId, new Date(Date.now() + 300_000).toISOString(), new Date(Date.now() - 120_000).toISOString()).run();
  await db.prepare(insert).bind("2".repeat(64), "ws_recovery", email, userId, "ca_newest", authConfigId, new Date(Date.now() + 300_000).toISOString(), new Date(Date.now() - 60_000).toISOString()).run();
  await db.prepare(insert).bind("3".repeat(64), "ws_recovery", email, userId, "ca_expired", authConfigId, new Date(Date.now() - 30_000).toISOString(), new Date(Date.now() - 10_000).toISOString()).run();
  const { cleanupComposioConnectionAttempts, getComposioConnectionAttempt, newestRecoverableComposioConnectionAttempt } = await import("../server/composio-attempts.ts");
  const now = new Date().toISOString();
  await cleanupComposioConnectionAttempts(db, now);
  const candidate = await newestRecoverableComposioConnectionAttempt(db, { workspaceId: "ws_recovery", email, composioUserId: userId, authConfigId, now });
  assert.equal(candidate.connected_account_id, "ca_newest");
  assert.equal(await getComposioConnectionAttempt(db, "3".repeat(64)), null);
});
