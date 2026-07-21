import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { vercelRuntimeEnv } from "../server/vercel-runtime.ts";

function mockD1() {
  const calls = [];
  const rows = new Map();
  const request = async (url, init) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, init, body });
    const queries = body.batch || [body];
    const result = queries.map((query) => {
      if (query.sql.startsWith("INSERT INTO vercel_artifacts")) rows.set(query.params[0], query.params.slice(1));
      const artifact = query.sql.startsWith("SELECT content_base64") ? rows.get(query.params[0]) : null;
      const results = artifact ? [{ content_base64: artifact[0], content_type: artifact[1], custom_metadata: artifact[2] }] : query.sql.startsWith("SELECT") ? [{ id: "row_1", score: 97 }] : [];
      return { success: true, results, meta: { changes: query.sql.startsWith("SELECT") ? 0 : 1, last_row_id: 7 } };
    });
    return new Response(JSON.stringify({ success: true, result }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, request };
}

test("Vercel runtime fails closed when durable storage is missing", () => {
  assert.throws(() => vercelRuntimeEnv({ VERCEL: "1" }, async () => new Response()), /VERCEL_STORAGE_NOT_CONFIGURED/);
});

test("Vercel runtime maps D1 statements, batches, and artifacts to the Cloudflare API", async () => {
  const mock = mockD1();
  const env = vercelRuntimeEnv({ VERCEL: "1", CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_D1_DATABASE_ID: "database", CLOUDFLARE_D1_API_TOKEN: "secret" }, mock.request);
  const first = await env.DB.prepare("SELECT id, score FROM checks WHERE id = ?").bind("row_1").first();
  assert.deepEqual(first, { id: "row_1", score: 97 });
  const batch = await env.DB.batch([env.DB.prepare("UPDATE checks SET score = ? WHERE id = ?").bind(98, "row_1"), env.DB.prepare("DELETE FROM checks WHERE id = ?").bind("row_2")]);
  assert.equal(batch.length, 2);
  assert.equal(mock.calls[0].init.headers.authorization, "Bearer secret");
  assert.match(mock.calls[0].url, /accounts\/account\/d1\/database\/database\/query$/);
  assert.deepEqual(mock.calls[1].body.batch[0].params, [98, "row_1"]);
  await env.ARTIFACTS.put("reports/demo.json", "{\"verified\":true}", { httpMetadata: { contentType: "application/json" }, customMetadata: { redacted: "true" } });
  const artifact = await env.ARTIFACTS.get("reports/demo.json");
  assert.equal(await artifact.text(), "{\"verified\":true}");
  assert.equal(artifact.httpMetadata.contentType, "application/json");
  assert.equal(artifact.customMetadata.redacted, "true");
});

test("Vercel runtime reports D1 API errors without exposing the token", async () => {
  const env = vercelRuntimeEnv({ VERCEL: "1", CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_D1_DATABASE_ID: "database", CLOUDFLARE_D1_API_TOKEN: "do-not-leak" }, async () => new Response(JSON.stringify({ success: false, errors: [{ message: "permission denied" }] }), { status: 403 }));
  await assert.rejects(() => env.DB.prepare("SELECT 1").first(), (error) => error.message.includes("permission denied") && !error.message.includes("do-not-leak"));
});

test("production runtime selects the Vercel adapter instead of Cloudflare Worker bindings", async () => {
  const previous = { VERCEL: process.env.VERCEL, account: process.env.CLOUDFLARE_ACCOUNT_ID, database: process.env.CLOUDFLARE_D1_DATABASE_ID, token: process.env.CLOUDFLARE_D1_API_TOKEN, local: process.env.WORLDMODEL_LOCAL_RUNTIME };
  process.env.VERCEL = "1";
  process.env.CLOUDFLARE_ACCOUNT_ID = "account";
  process.env.CLOUDFLARE_D1_DATABASE_ID = "database";
  process.env.CLOUDFLARE_D1_API_TOKEN = "secret";
  delete process.env.WORLDMODEL_LOCAL_RUNTIME;
  try {
    const { getRuntimeEnv } = await import("../server/runtime-env.ts");
    const env = await getRuntimeEnv();
    assert.equal(env.VERCEL_RUNTIME, "true");
    assert.equal(typeof env.DB.prepare, "function");
  } finally {
    if (previous.VERCEL === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous.VERCEL;
    if (previous.account === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = previous.account;
    if (previous.database === undefined) delete process.env.CLOUDFLARE_D1_DATABASE_ID; else process.env.CLOUDFLARE_D1_DATABASE_ID = previous.database;
    if (previous.token === undefined) delete process.env.CLOUDFLARE_D1_API_TOKEN; else process.env.CLOUDFLARE_D1_API_TOKEN = previous.token;
    if (previous.local === undefined) delete process.env.WORLDMODEL_LOCAL_RUNTIME; else process.env.WORLDMODEL_LOCAL_RUNTIME = previous.local;
  }
});

test("Vercel build preflight warns about missing durable storage without printing secrets", () => {
  const result = spawnSync(process.execPath, ["scripts/check-vercel-env.mjs"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, VERCEL: "1", VERCEL_ENV: "production", CLOUDFLARE_D1_API_TOKEN: "never-print-this", CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_D1_DATABASE_ID: "", WORLDMODEL_PUBLIC_ORIGIN: "" } });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(result.stderr, /build will continue/i);
  assert.match(result.stderr, /WORLDMODEL_PUBLIC_ORIGIN/);
  assert.doesNotMatch(result.stderr, /never-print-this/);
});

test("Vercel build preflight accepts complete production storage configuration", () => {
  const result = spawnSync(process.execPath, ["scripts/check-vercel-env.mjs"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, VERCEL: "1", VERCEL_ENV: "production", CLOUDFLARE_D1_API_TOKEN: "secret", CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_D1_DATABASE_ID: "database", WORLDMODEL_PUBLIC_ORIGIN: "https://worldmodel.example" } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /storage preflight passed/);
});
