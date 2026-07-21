import assert from "node:assert/strict";
import test from "node:test";

import {
  githubRepositoryFileAtCommitWithToken,
  publishGithubDraftFilesWithToken,
} from "../server/github.ts";

const BASE_SHA = "a".repeat(40);
const BASE_TREE_SHA = "b".repeat(40);
const BLOB_SHA = "c".repeat(40);
const CANDIDATE_TREE_SHA = "d".repeat(40);
const CANDIDATE_COMMIT_SHA = "e".repeat(40);
const RACED_COMMIT_SHA = "f".repeat(40);

function freshDraftInput() {
  return {
    owner: "octocat",
    repository: "Hello-World",
    baseBranch: "main",
    baseSha: BASE_SHA,
    headBranch: "worldmodel/report-contract-fresh-1234567890",
    title: "draft: verified repair",
    body: "Fixture verification report",
    files: [{ path: "src/repair.ts", content: "export const repaired = true;\n" }],
    freshBranchFromBase: true,
  };
}

function draftPull(number = 17, headSha = CANDIDATE_COMMIT_SHA) {
  return {
    number,
    html_url: `https://github.com/octocat/Hello-World/pull/${number}`,
    draft: true,
    state: "open",
    merged_at: null,
    head: { ref: "worldmodel/report-contract-fresh-1234567890", sha: headSha, repo: { full_name: "octocat/Hello-World" } },
    base: { ref: "main", repo: { full_name: "octocat/Hello-World" } },
  };
}

test("GitHub workflow reads and draft publication are pinned to immutable commits", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const expectedWorkflow = "name: WorldModel verified runner\n";

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body, headers: init.headers });
    assert.equal(init.headers.authorization, "Bearer installation-token");

    if (url.pathname.endsWith("/.github/workflows/worldmodel-proj_verified.yml")) {
      assert.equal(url.searchParams.get("ref"), BASE_SHA);
      return Response.json({
        type: "file",
        encoding: "base64",
        content: Buffer.from(expectedWorkflow).toString("base64"),
        size: Buffer.byteLength(expectedWorkflow),
      });
    }
    if (method === "GET" && url.pathname.endsWith(`/git/commits/${BASE_SHA}`)) {
      return Response.json({ sha: BASE_SHA, tree: { sha: BASE_TREE_SHA } });
    }
    if (method === "GET" && url.pathname.includes("/git/ref/heads/worldmodel/")) {
      return Response.json({ message: "Not Found" }, { status: 404 });
    }
    if (method === "POST" && url.pathname.endsWith("/git/blobs")) {
      return Response.json({ sha: BLOB_SHA }, { status: 201 });
    }
    if (method === "POST" && url.pathname.endsWith("/git/trees")) {
      return Response.json({ sha: CANDIDATE_TREE_SHA }, { status: 201 });
    }
    if (method === "POST" && url.pathname.endsWith("/git/commits")) {
      return Response.json({ sha: CANDIDATE_COMMIT_SHA }, { status: 201 });
    }
    if (method === "POST" && url.pathname.endsWith("/git/refs")) {
      return Response.json({ ref: body.ref, object: { sha: body.sha } }, { status: 201 });
    }
    if (method === "GET" && url.pathname.endsWith("/pulls")) {
      return Response.json([]);
    }
    if (method === "POST" && url.pathname.endsWith("/pulls")) {
      return Response.json(draftPull(), { status: 201 });
    }
    throw new Error(`Unexpected GitHub request: ${method} ${url}`);
  };

  try {
    const workflow = await githubRepositoryFileAtCommitWithToken(
      "octocat/Hello-World",
      ".github/workflows/worldmodel-proj_verified.yml",
      BASE_SHA,
      "installation-token",
    );
    assert.equal(workflow, expectedWorkflow);

    const published = await publishGithubDraftFilesWithToken(freshDraftInput(), "installation-token");

    assert.deepEqual(published, {
      number: 17,
      html_url: "https://github.com/octocat/Hello-World/pull/17",
      draft: true,
    });
    assert.equal(calls.some(({ method, url }) => method === "GET" && url.pathname.includes("/git/ref/heads/")), true);
    assert.equal(calls.some(({ url }) => url.pathname.includes("/contents/src/repair.ts")), false);

    const blob = calls.find(({ method, url }) => method === "POST" && url.pathname.endsWith("/git/blobs"));
    assert.equal(Buffer.from(blob.body.content, "base64").toString("utf8"), "export const repaired = true;\n");
    const tree = calls.find(({ method, url }) => method === "POST" && url.pathname.endsWith("/git/trees"));
    assert.equal(tree.body.base_tree, BASE_TREE_SHA);
    assert.deepEqual(tree.body.tree, [{ path: "src/repair.ts", mode: "100644", type: "blob", sha: BLOB_SHA }]);
    const commit = calls.find(({ method, url }) => method === "POST" && url.pathname.endsWith("/git/commits"));
    assert.deepEqual(commit.body.parents, [BASE_SHA]);
    assert.equal(commit.body.tree, CANDIDATE_TREE_SHA);
    const branch = calls.find(({ method, url }) => method === "POST" && url.pathname.endsWith("/git/refs"));
    assert.deepEqual(branch.body, {
      ref: "refs/heads/worldmodel/report-contract-fresh-1234567890",
      sha: CANDIDATE_COMMIT_SHA,
    });
    const pull = calls.find(({ method, url }) => method === "POST" && url.pathname.endsWith("/pulls"));
    assert.equal(pull.body.draft, true);
    assert.equal(pull.body.head, "worldmodel/report-contract-fresh-1234567890");
    const pullLookupIndex = calls.findIndex(({ method, url }) => method === "GET" && url.pathname.endsWith("/pulls"));
    const pullCreateIndex = calls.findIndex(({ method, url }) => method === "POST" && url.pathname.endsWith("/pulls"));
    assert.ok(pullLookupIndex >= 0 && pullLookupIndex < pullCreateIndex, "an existing pull request is queried before creation");
    assert.equal(calls[pullLookupIndex].url.searchParams.get("state"), "all");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fresh GitHub draft retries reuse only an exact branch commit and existing pull request", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET" && url.pathname.endsWith(`/git/commits/${BASE_SHA}`)) return Response.json({ sha: BASE_SHA, tree: { sha: BASE_TREE_SHA } });
    if (method === "POST" && url.pathname.endsWith("/git/blobs")) return Response.json({ sha: BLOB_SHA }, { status: 201 });
    if (method === "POST" && url.pathname.endsWith("/git/trees")) return Response.json({ sha: CANDIDATE_TREE_SHA }, { status: 201 });
    if (method === "GET" && url.pathname.includes("/git/ref/heads/worldmodel/")) return Response.json({ object: { sha: CANDIDATE_COMMIT_SHA } });
    if (method === "GET" && url.pathname.endsWith(`/git/commits/${CANDIDATE_COMMIT_SHA}`)) return Response.json({ sha: CANDIDATE_COMMIT_SHA, tree: { sha: CANDIDATE_TREE_SHA }, parents: [{ sha: BASE_SHA }] });
    if (method === "GET" && url.pathname.endsWith("/pulls")) return Response.json([draftPull()]);
    throw new Error(`Unexpected GitHub retry request: ${method} ${url}`);
  };
  try {
    assert.deepEqual(await publishGithubDraftFilesWithToken(freshDraftInput(), "installation-token"), {
      number: 17,
      html_url: "https://github.com/octocat/Hello-World/pull/17",
      draft: true,
    });
    assert.equal(calls.some(({ method, url }) => method === "POST" && url.pathname.endsWith("/git/commits")), false);
    assert.equal(calls.some(({ method, url }) => method === "POST" && url.pathname.endsWith("/git/refs")), false);
    assert.equal(calls.some(({ method, url }) => method === "POST" && url.pathname.endsWith("/pulls")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fresh GitHub draft retries reject a closed or merged historical pull request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";
    if (method === "GET" && url.pathname.endsWith(`/git/commits/${BASE_SHA}`)) return Response.json({ sha: BASE_SHA, tree: { sha: BASE_TREE_SHA } });
    if (method === "POST" && url.pathname.endsWith("/git/blobs")) return Response.json({ sha: BLOB_SHA }, { status: 201 });
    if (method === "POST" && url.pathname.endsWith("/git/trees")) return Response.json({ sha: CANDIDATE_TREE_SHA }, { status: 201 });
    if (method === "GET" && url.pathname.includes("/git/ref/heads/worldmodel/")) return Response.json({ object: { sha: CANDIDATE_COMMIT_SHA } });
    if (method === "GET" && url.pathname.endsWith(`/git/commits/${CANDIDATE_COMMIT_SHA}`)) return Response.json({ sha: CANDIDATE_COMMIT_SHA, tree: { sha: CANDIDATE_TREE_SHA }, parents: [{ sha: BASE_SHA }] });
    if (method === "GET" && url.pathname.endsWith("/pulls")) return Response.json([{ ...draftPull(), state: "closed", merged_at: "2026-01-01T00:00:00Z" }]);
    throw new Error(`Unexpected GitHub closed-pull request: ${method} ${url}`);
  };
  try {
    await assert.rejects(
      publishGithubDraftFilesWithToken(freshDraftInput(), "installation-token"),
      /not an open draft at the verified branch head/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [label, existingCommit] of [
  ["a different generated tree", { sha: CANDIDATE_COMMIT_SHA, tree: { sha: "1".repeat(40) }, parents: [{ sha: BASE_SHA }] }],
  ["a different base parent", { sha: CANDIDATE_COMMIT_SHA, tree: { sha: CANDIDATE_TREE_SHA }, parents: [{ sha: "2".repeat(40) }] }],
  ["more than one parent", { sha: CANDIDATE_COMMIT_SHA, tree: { sha: CANDIDATE_TREE_SHA }, parents: [{ sha: BASE_SHA }, { sha: "3".repeat(40) }] }],
]) {
  test(`fresh GitHub draft retries reject an existing branch with ${label}`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method || "GET";
      if (method === "GET" && url.pathname.endsWith(`/git/commits/${BASE_SHA}`)) return Response.json({ sha: BASE_SHA, tree: { sha: BASE_TREE_SHA } });
      if (method === "POST" && url.pathname.endsWith("/git/blobs")) return Response.json({ sha: BLOB_SHA }, { status: 201 });
      if (method === "POST" && url.pathname.endsWith("/git/trees")) return Response.json({ sha: CANDIDATE_TREE_SHA }, { status: 201 });
      if (method === "GET" && url.pathname.includes("/git/ref/heads/worldmodel/")) return Response.json({ object: { sha: CANDIDATE_COMMIT_SHA } });
      if (method === "GET" && url.pathname.endsWith(`/git/commits/${CANDIDATE_COMMIT_SHA}`)) return Response.json(existingCommit);
      throw new Error(`Unexpected GitHub conflict request: ${method} ${url}`);
    };
    try {
      await assert.rejects(
        publishGithubDraftFilesWithToken(freshDraftInput(), "installation-token"),
        /draft branch conflicts with the approved repair candidate/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("fresh GitHub draft publication reconciles branch and pull-request creation races", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let headLookups = 0;
  let pullLookups = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET" && url.pathname.endsWith(`/git/commits/${BASE_SHA}`)) return Response.json({ sha: BASE_SHA, tree: { sha: BASE_TREE_SHA } });
    if (method === "POST" && url.pathname.endsWith("/git/blobs")) return Response.json({ sha: BLOB_SHA }, { status: 201 });
    if (method === "POST" && url.pathname.endsWith("/git/trees")) return Response.json({ sha: CANDIDATE_TREE_SHA }, { status: 201 });
    if (method === "GET" && url.pathname.includes("/git/ref/heads/worldmodel/")) {
      headLookups += 1;
      return headLookups === 1
        ? Response.json({ message: "Not Found" }, { status: 404 })
        : Response.json({ object: { sha: RACED_COMMIT_SHA } });
    }
    if (method === "POST" && url.pathname.endsWith("/git/commits")) return Response.json({ sha: CANDIDATE_COMMIT_SHA }, { status: 201 });
    if (method === "POST" && url.pathname.endsWith("/git/refs")) return Response.json({ message: "Reference already exists" }, { status: 422 });
    if (method === "GET" && url.pathname.endsWith(`/git/commits/${RACED_COMMIT_SHA}`)) return Response.json({ sha: RACED_COMMIT_SHA, tree: { sha: CANDIDATE_TREE_SHA }, parents: [{ sha: BASE_SHA }] });
    if (method === "GET" && url.pathname.endsWith("/pulls")) {
      pullLookups += 1;
      return pullLookups === 1
        ? Response.json([])
        : Response.json([draftPull(19, RACED_COMMIT_SHA)]);
    }
    if (method === "POST" && url.pathname.endsWith("/pulls")) return Response.json({ message: "A pull request already exists" }, { status: 422 });
    throw new Error(`Unexpected GitHub race request: ${method} ${url}`);
  };
  try {
    assert.deepEqual(await publishGithubDraftFilesWithToken(freshDraftInput(), "installation-token"), {
      number: 19,
      html_url: "https://github.com/octocat/Hello-World/pull/19",
      draft: true,
    });
    assert.equal(headLookups, 2, "a branch-create conflict is reconciled against the winning branch");
    assert.equal(pullLookups, 2, "a pull-create conflict is reconciled against the winning pull request");
    assert.equal(calls.filter(({ method, url }) => method === "POST" && url.pathname.endsWith("/git/refs")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
