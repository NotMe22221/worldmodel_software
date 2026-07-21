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
    if (method === "POST" && url.pathname.endsWith("/pulls")) {
      return Response.json({
        number: 17,
        html_url: "https://github.com/octocat/Hello-World/pull/17",
        draft: true,
      }, { status: 201 });
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

    const published = await publishGithubDraftFilesWithToken({
      owner: "octocat",
      repository: "Hello-World",
      baseBranch: "main",
      baseSha: BASE_SHA,
      headBranch: "worldmodel/report-contract-fresh-1234567890",
      title: "draft: verified repair",
      body: "Fixture verification report",
      files: [{ path: "src/repair.ts", content: "export const repaired = true;\n" }],
      freshBranchFromBase: true,
    }, "installation-token");

    assert.deepEqual(published, {
      number: 17,
      html_url: "https://github.com/octocat/Hello-World/pull/17",
      draft: true,
    });
    assert.equal(calls.some(({ method, url }) => method === "GET" && url.pathname.includes("/git/ref/heads/")), false);
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
