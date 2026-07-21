import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
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

test("Vercel build preflight requires exposed system environment variables", () => {
  const result = spawnSync(process.execPath, ["scripts/check-vercel-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "", VERCEL_ENV: "", TURSO_DATABASE_URL: "libsql://worldmodel.turso.io", TURSO_AUTH_TOKEN: "never-print-this", WORLDMODEL_PUBLIC_ORIGIN: "https://worldmodel.example" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Automatically expose System Environment Variables/);
  assert.doesNotMatch(result.stderr, /never-print-this/);
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
    localDevelopment: process.env.LOCAL_DEVELOPMENT,
  };
  process.env.VERCEL = "1";
  process.env.TURSO_DATABASE_URL = "libsql://worldmodel.turso.io";
  process.env.TURSO_AUTH_TOKEN = "secret";
  process.env.WORLDMODEL_LOCAL_RUNTIME = "true";
  process.env.LOCAL_DEVELOPMENT = "true";
  try {
    const { getRuntimeEnv } = await import("../server/runtime-env.ts");
    const env = await getRuntimeEnv();
    assert.equal(env.VERCEL_RUNTIME, "true");
    assert.equal(env.VERCEL_STORAGE_PROVIDER, "turso");
    assert.equal(env.WORLDMODEL_LOCAL_RUNTIME, "false");
    assert.equal(env.LOCAL_DEVELOPMENT, "false");
    assert.equal(typeof env.DB.prepare, "function");
  } finally {
    if (previous.VERCEL === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous.VERCEL;
    if (previous.url === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previous.url;
    if (previous.token === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = previous.token;
    if (previous.local === undefined) delete process.env.WORLDMODEL_LOCAL_RUNTIME; else process.env.WORLDMODEL_LOCAL_RUNTIME = previous.local;
    if (previous.localDevelopment === undefined) delete process.env.LOCAL_DEVELOPMENT; else process.env.LOCAL_DEVELOPMENT = previous.localDevelopment;
  }
});

test("Vercel production build preflight fails closed on missing Turso storage without printing secrets", () => {
  const result = spawnSync(process.execPath, ["scripts/check-vercel-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1", VERCEL_ENV: "production", TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "never-print-this", WORLDMODEL_PUBLIC_ORIGIN: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TURSO_DATABASE_URL/);
  assert.match(result.stderr, /Connect Turso/i);
  assert.doesNotMatch(result.stderr, /never-print-this/);
});

test("Vercel preview build preflight warns instead of masking its configuration state", () => {
  const result = spawnSync(process.execPath, ["scripts/check-vercel-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "worldmodel-preview.vercel.app", TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "never-print-this", WORLDMODEL_PUBLIC_ORIGIN: "" },
  });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /Preview data-backed routes/i);
  assert.match(result.stdout, /canonical deployment origin detected/);
  assert.doesNotMatch(result.stderr, /never-print-this/);
});

test("Vercel build preflight accepts complete production Turso configuration", () => {
  const result = spawnSync(process.execPath, ["scripts/check-vercel-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1", VERCEL_ENV: "production", TURSO_DATABASE_URL: "libsql://worldmodel.turso.io", TURSO_AUTH_TOKEN: "secret", WORLDMODEL_PUBLIC_ORIGIN: "https://worldmodel.example", VERCEL_PROJECT_PRODUCTION_URL: "" },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /storage preflight passed/);
  assert.match(result.stdout, /deployment origin override detected/);
});

test("Vercel build preflight accepts its automatic canonical production URL", () => {
  const result = spawnSync(process.execPath, ["scripts/check-vercel-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1", VERCEL_ENV: "production", TURSO_DATABASE_URL: "libsql://worldmodel.turso.io", TURSO_AUTH_TOKEN: "secret", WORLDMODEL_PUBLIC_ORIGIN: "", VERCEL_PROJECT_PRODUCTION_URL: "worldmodel-software.vercel.app" },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Vercel canonical deployment origin detected/);
  assert.doesNotMatch(result.stderr, /No canonical deployment origin/);
});

test("Vercel build preflight rejects an invalid production origin without printing it", () => {
  const result = spawnSync(process.execPath, ["scripts/check-vercel-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1", VERCEL_ENV: "production", TURSO_DATABASE_URL: "libsql://worldmodel.turso.io", TURSO_AUTH_TOKEN: "secret", WORLDMODEL_PUBLIC_ORIGIN: "https://user:never-print-this@", VERCEL_PROJECT_PRODUCTION_URL: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /canonical HTTPS origin/);
  assert.doesNotMatch(result.stderr, /never-print-this/);
});

test("Vercel build preflight validates preview overrides and requires a system URL", () => {
  const invalid = spawnSync(process.execPath, ["scripts/check-vercel-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "worldmodel-preview.vercel.app", TURSO_DATABASE_URL: "libsql://worldmodel.turso.io", TURSO_AUTH_TOKEN: "secret", WORLDMODEL_PUBLIC_ORIGIN: "https://preview.example/oauth/callback" },
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /canonical HTTPS origin/);

  const missing = spawnSync(process.execPath, ["scripts/check-vercel-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "", TURSO_DATABASE_URL: "libsql://worldmodel.turso.io", TURSO_AUTH_TOKEN: "secret", WORLDMODEL_PUBLIC_ORIGIN: "", VERCEL_PROJECT_PRODUCTION_URL: "" },
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No canonical deployment origin/);
});

test("Vercel build preflight rejects local-only runtime flags", () => {
  const result = spawnSync(process.execPath, ["scripts/check-vercel-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1", VERCEL_ENV: "production", TURSO_DATABASE_URL: "libsql://worldmodel.turso.io", TURSO_AUTH_TOKEN: "secret", WORLDMODEL_LOCAL_RUNTIME: "true" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /local-only flags/i);
  assert.match(result.stderr, /WORLDMODEL_LOCAL_RUNTIME/);
  assert.doesNotMatch(result.stderr, /secret/);
});

test("registered migrations include the product and tenant-isolation schema", () => {
  const database = new DatabaseSync(":memory:");
  const migrations = readMigrationFiles({
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  });
  for (const migration of migrations) {
    for (const statement of migration.sql) {
      if (statement.trim()) database.exec(statement);
    }
  }
  const names = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('model_versions','composio_connections','github_workspace_installations','github_workspace_repositories') ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.deepEqual(names, [
    "composio_connections",
    "github_workspace_installations",
    "github_workspace_repositories",
    "model_versions",
  ]);
});

test("existing databases can register the old manual product migration before upgrading", () => {
  const database = new DatabaseSync(":memory:");
  const migrations = readMigrationFiles({
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  });

  for (const migration of migrations.slice(0, 17)) {
    for (const statement of migration.sql) {
      if (statement.trim()) database.exec(statement);
    }
  }

  // Before 0017 was registered in Drizzle's journal, the deployment guide told
  // operators to apply its original, non-idempotent SQL manually. Recreate that
  // state, then prove the now-registered migration can be applied safely.
  for (const statement of migrations[17].sql) {
    const originalStatement = statement
      .replace(/^CREATE TABLE IF NOT EXISTS /, "CREATE TABLE ")
      .replace(/^CREATE UNIQUE INDEX IF NOT EXISTS /, "CREATE UNIQUE INDEX ")
      .replace(/^CREATE INDEX IF NOT EXISTS /, "CREATE INDEX ");
    if (originalStatement.trim()) database.exec(originalStatement);
  }
  for (const statement of migrations[17].sql) {
    if (statement.trim()) database.exec(statement);
  }

  const beforeUpgrade = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'composio_%'")
    .all();
  assert.deepEqual(beforeUpgrade, []);

  for (const migration of migrations.slice(18)) {
    for (const statement of migration.sql) {
      if (statement.trim()) database.exec(statement);
    }
  }

  const afterUpgrade = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'composio_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.deepEqual(afterUpgrade, [
    "composio_connection_attempts",
    "composio_connections",
    "composio_github_repositories",
  ]);
});
