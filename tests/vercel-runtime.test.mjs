import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { vercelRuntimeEnv } from "../server/vercel-runtime.ts";

function result(columns = [], rows = [], rowsAffected = 0, lastInsertRowid) {
  return { columns, columnTypes: columns.map(() => "TEXT"), rows, rowsAffected, lastInsertRowid, toJSON() { return this; } };
}

function mockLibsql() {
  const calls = [];
  const artifacts = new Map();
  let config;

  const client = {
    async execute(statement) {
      const { sql, args = [] } = statement;
      calls.push({ sql, args });
      if (sql.startsWith("INSERT INTO vercel_artifacts")) {
        artifacts.set(args[0], args.slice(1));
        return result([], [], 1, 7n);
      }
      if (sql.startsWith("SELECT content_base64")) {
        const artifact = artifacts.get(args[0]);
        return artifact ? result(["content_base64", "content_type", "custom_metadata"], [artifact.slice(0, 3)]) : result(["content_base64", "content_type", "custom_metadata"]);
      }
      if (sql.startsWith("SELECT")) return result(["id", "score"], [["row_1", 97]]);
      return result([], [], 1, 7n);
    },
    async batch(statements) {
      return await Promise.all(statements.map((statement) => client.execute(statement)));
    },
  };

  return {
    calls,
    factory(value) { config = value; return client; },
    get config() { return config; },
  };
}

test("Vercel runtime fails closed when durable storage is missing", () => {
  assert.throws(() => vercelRuntimeEnv({ VERCEL: "1" }), /VERCEL_STORAGE_NOT_CONFIGURED/);
});

test("Vercel runtime maps SQLite statements, batches, and artifacts to Turso", async () => {
  const mock = mockLibsql();
  const env = vercelRuntimeEnv({ VERCEL: "1", TURSO_DATABASE_URL: "libsql://worldmodel.turso.io", TURSO_AUTH_TOKEN: "secret" }, mock.factory);
  const first = await env.DB.prepare("SELECT id, score FROM checks WHERE id = ?").bind("row_1").first();
  assert.deepEqual(first, { id: "row_1", score: 97 });
  const batch = await env.DB.batch([
    env.DB.prepare("UPDATE checks SET score = ? WHERE id = ?").bind(98, "row_1"),
    env.DB.prepare("DELETE FROM checks WHERE id = ?").bind("row_2"),
  ]);
  assert.equal(batch.length, 2);
  assert.deepEqual(mock.config, { url: "libsql://worldmodel.turso.io", authToken: "secret", intMode: "number" });
  assert.deepEqual(mock.calls[0].args, ["row_1"]);
  assert.deepEqual(mock.calls[1].args, [98, "row_1"]);
  assert.equal(env.VERCEL_STORAGE_PROVIDER, "turso");

  await env.ARTIFACTS.put("reports/demo.json", "{\"verified\":true}", { httpMetadata: { contentType: "application/json" }, customMetadata: { redacted: "true" } });
  const artifact = await env.ARTIFACTS.get("reports/demo.json");
  assert.equal(await artifact.text(), "{\"verified\":true}");
  assert.equal(artifact.httpMetadata.contentType, "application/json");
  assert.equal(artifact.customMetadata.redacted, "true");
});

test("Vercel runtime reports libSQL errors without exposing the token", async () => {
  const factory = () => ({
    async execute() { throw new Error("permission denied for do-not-leak"); },
    async batch() { throw new Error("permission denied for do-not-leak"); },
  });
  const env = vercelRuntimeEnv({ VERCEL: "1", TURSO_DATABASE_URL: "libsql://worldmodel.turso.io", TURSO_AUTH_TOKEN: "do-not-leak" }, factory);
  await assert.rejects(() => env.DB.prepare("SELECT 1").first(), (error) => error.message.includes("permission denied") && !error.message.includes("do-not-leak"));
});

test("production runtime selects the Turso-backed Vercel adapter", async () => {
  const previous = {
    VERCEL: process.env.VERCEL,
    url: process.env.TURSO_DATABASE_URL,
    token: process.env.TURSO_AUTH_TOKEN,
    local: process.env.WORLDMODEL_LOCAL_RUNTIME,
  };
  process.env.VERCEL = "1";
  process.env.TURSO_DATABASE_URL = "libsql://worldmodel.turso.io";
  process.env.TURSO_AUTH_TOKEN = "secret";
  delete process.env.WORLDMODEL_LOCAL_RUNTIME;
  try {
    const { getRuntimeEnv } = await import("../server/runtime-env.ts");
    const env = await getRuntimeEnv();
    assert.equal(env.VERCEL_RUNTIME, "true");
    assert.equal(env.VERCEL_STORAGE_PROVIDER, "turso");
    assert.equal(typeof env.DB.prepare, "function");
  } finally {
    if (previous.VERCEL === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous.VERCEL;
    if (previous.url === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previous.url;
    if (previous.token === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = previous.token;
    if (previous.local === undefined) delete process.env.WORLDMODEL_LOCAL_RUNTIME; else process.env.WORLDMODEL_LOCAL_RUNTIME = previous.local;
  }
});

test("Vercel build preflight warns about missing Turso storage without printing secrets", () => {
  const result = spawnSync(process.execPath, ["scripts/check-vercel-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1", VERCEL_ENV: "production", TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "never-print-this", WORLDMODEL_PUBLIC_ORIGIN: "" },
  });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /TURSO_DATABASE_URL/);
  assert.match(result.stderr, /build will continue/i);
  assert.match(result.stderr, /WORLDMODEL_PUBLIC_ORIGIN/);
  assert.doesNotMatch(result.stderr, /never-print-this/);
});

test("Vercel build preflight accepts complete production Turso configuration", () => {
  const result = spawnSync(process.execPath, ["scripts/check-vercel-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1", VERCEL_ENV: "production", TURSO_DATABASE_URL: "libsql://worldmodel.turso.io", TURSO_AUTH_TOKEN: "secret", WORLDMODEL_PUBLIC_ORIGIN: "https://worldmodel.example" },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /storage preflight passed/);
});
