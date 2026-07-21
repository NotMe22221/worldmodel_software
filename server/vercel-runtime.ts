import { createClient, type Client, type InValue, type ResultSet, type Row } from "@libsql/client";

type Query = { sql: string; params: InValue[] };
type QueryResult = {
  results: Record<string, unknown>[];
  success: true;
  meta: { changes: number; last_row_id: number | string };
};

type LibsqlClient = Pick<Client, "execute" | "batch">;
type ClientFactory = (config: { url: string; authToken: string; intMode: "number" }) => LibsqlClient;

class LibsqlStatement {
  private readonly database: LibsqlDatabase;
  private readonly sql: string;
  private readonly values: InValue[];

  constructor(database: LibsqlDatabase, sql: string, values: InValue[] = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new LibsqlStatement(this.database, this.sql, values.map(normalizeValue));
  }

  async first<T = Record<string, unknown>>() {
    return (await this.database.execute(this.query())).results[0] as T | undefined || null;
  }

  async all<T = Record<string, unknown>>() {
    const result = await this.database.execute(this.query());
    return { results: result.results as T[], success: true, meta: result.meta };
  }

  async run() {
    const result = await this.database.execute(this.query());
    return { success: true, meta: result.meta };
  }

  query(): Query {
    return { sql: this.sql, params: this.values };
  }
}

function normalizeValue(value: unknown): InValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date || value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
  throw new Error(`VERCEL_LIBSQL_INVALID_VALUE: Unsupported database parameter type ${typeof value}`);
}

function rowsFrom(result: ResultSet) {
  return result.rows.map((row: Row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])));
}

function queryResult(result: ResultSet): QueryResult {
  const lastInsertRowid = result.lastInsertRowid;
  return {
    results: rowsFrom(result),
    success: true,
    meta: {
      changes: result.rowsAffected,
      last_row_id: lastInsertRowid === undefined ? 0 : lastInsertRowid.toString(),
    },
  };
}

export class LibsqlDatabase {
  private readonly client: LibsqlClient;
  private readonly token: string;

  constructor(client: LibsqlClient, token: string) {
    this.client = client;
    this.token = token;
  }

  prepare(sql: string) {
    return new LibsqlStatement(this, sql);
  }

  async execute(query: Query) {
    try {
      return queryResult(await this.client.execute({ sql: query.sql, args: query.params }));
    } catch (error) {
      throw this.queryError(error);
    }
  }

  async batch(statements: LibsqlStatement[]) {
    try {
      const results = await this.client.batch(statements.map((statement) => {
        const query = statement.query();
        return { sql: query.sql, args: query.params };
      }), "write");
      return results.map(queryResult);
    } catch (error) {
      throw this.queryError(error);
    }
  }

  private queryError(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    const detail = this.token ? raw.split(this.token).join("[redacted]") : raw;
    return new Error(`VERCEL_LIBSQL_QUERY_FAILED: ${detail}`);
  }
}

class LibsqlArtifactStore {
  private initialized?: Promise<void>;
  private readonly database: LibsqlDatabase;

  constructor(database: LibsqlDatabase) {
    this.database = database;
  }

  private ensure() {
    return this.initialized ||= this.database
      .prepare("CREATE TABLE IF NOT EXISTS vercel_artifacts (key TEXT PRIMARY KEY, content_base64 TEXT NOT NULL, content_type TEXT, custom_metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
      .run()
      .then(() => undefined);
  }

  async put(key: string, value: string | ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) {
    await this.ensure();
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
    const content = Buffer.from(bytes).toString("base64");
    await this.database
      .prepare("INSERT INTO vercel_artifacts (key, content_base64, content_type, custom_metadata) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET content_base64=excluded.content_base64, content_type=excluded.content_type, custom_metadata=excluded.custom_metadata, created_at=CURRENT_TIMESTAMP")
      .bind(key, content, options?.httpMetadata?.contentType || "application/octet-stream", JSON.stringify(options?.customMetadata || {}))
      .run();
    return { key };
  }

  async get(key: string) {
    await this.ensure();
    const row = await this.database
      .prepare("SELECT content_base64, content_type, custom_metadata FROM vercel_artifacts WHERE key = ?")
      .bind(key)
      .first<Record<string, unknown>>();
    if (!row) return null;
    const bytes = Buffer.from(String(row.content_base64), "base64");
    return {
      text: async () => bytes.toString("utf8"),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      httpMetadata: { contentType: String(row.content_type || "application/octet-stream") },
      customMetadata: JSON.parse(String(row.custom_metadata || "{}")),
    };
  }
}

type RuntimeGlobal = typeof globalThis & { __worldmodelVercelEnv?: Record<string, unknown> };

export function vercelRuntimeEnv(environment: NodeJS.ProcessEnv = process.env, clientFactory: ClientFactory = createClient) {
  const global = globalThis as RuntimeGlobal;
  if (global.__worldmodelVercelEnv && environment === process.env && clientFactory === createClient) return global.__worldmodelVercelEnv;

  const url = environment.TURSO_DATABASE_URL?.trim();
  const token = environment.TURSO_AUTH_TOKEN?.trim();
  if (!url || !token) {
    throw new Error("VERCEL_STORAGE_NOT_CONFIGURED: Connect Turso from the Vercel Marketplace so TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are available");
  }

  const client = clientFactory({ url, authToken: token, intMode: "number" });
  const database = new LibsqlDatabase(client, token);
  const runtime = {
    ...environment,
    // Never let deployment variables opt a Vercel function into local-only
    // credential editing, fixture routes, or ephemeral SQLite storage.
    LOCAL_DEVELOPMENT: "false",
    WORLDMODEL_LOCAL_RUNTIME: "false",
    COMPOSIO_FIXTURE_MODE: "false",
    DB: database,
    ARTIFACTS: new LibsqlArtifactStore(database),
    VERCEL_RUNTIME: "true",
    VERCEL_STORAGE_PROVIDER: "turso",
  };
  if (environment === process.env && clientFactory === createClient) global.__worldmodelVercelEnv = runtime;
  return runtime;
}
