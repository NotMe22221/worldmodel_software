type D1Value = string | number | null | boolean;
type Query = { sql: string; params: D1Value[] };
type QueryResult = { results?: Record<string, unknown>[]; success?: boolean; meta?: { changes?: number; last_row_id?: number | string }; error?: string };
type ApiResult = { success?: boolean; result?: QueryResult[]; errors?: Array<{ message?: string }> };

class RemoteStatement {
  private readonly database: RemoteD1;
  private readonly sql: string;
  private readonly values: D1Value[];
  constructor(database: RemoteD1, sql: string, values: D1Value[] = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values: unknown[]) { return new RemoteStatement(this.database, this.sql, values.map(normalizeValue)); }
  async first<T = Record<string, unknown>>() { return (await this.database.execute({ sql: this.sql, params: this.values })).results?.[0] as T | undefined || null; }
  async all<T = Record<string, unknown>>() { const result = await this.database.execute({ sql: this.sql, params: this.values }); return { results: (result.results || []) as T[], success: true, meta: result.meta || {} }; }
  async run() { const result = await this.database.execute({ sql: this.sql, params: this.values }); return { success: true, meta: { changes: Number(result.meta?.changes || 0), last_row_id: result.meta?.last_row_id || 0 } }; }
  query() { return { sql: this.sql, params: this.values }; }
}

function normalizeValue(value: unknown): D1Value {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new Error(`VERCEL_D1_INVALID_VALUE: Unsupported D1 parameter type ${typeof value}`);
}

export class RemoteD1 {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly request: typeof fetch;
  constructor(accountId: string, databaseId: string, token: string, request: typeof fetch = fetch) {
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;
    this.token = token;
    this.request = request;
  }
  prepare(sql: string) { return new RemoteStatement(this, sql); }
  async execute(query: Query) { return (await this.query(query))[0]; }
  async batch(statements: RemoteStatement[]) { return await this.query({ batch: statements.map((statement) => statement.query()) }); }
  private async query(body: Query | { batch: Query[] }): Promise<QueryResult[]> {
    const response = await this.request(this.endpoint, { method: "POST", headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as ApiResult;
    if (!response.ok || !payload.success || !payload.result?.every((result) => result.success !== false)) {
      const detail = payload.errors?.map((error) => error.message).filter(Boolean).join("; ") || payload.result?.find((result) => result.success === false)?.error || `HTTP ${response.status}`;
      throw new Error(`VERCEL_D1_QUERY_FAILED: ${detail}`);
    }
    return payload.result;
  }
}

class D1ArtifactStore {
  private initialized?: Promise<void>;
  private readonly database: RemoteD1;
  constructor(database: RemoteD1) { this.database = database; }
  private ensure() { return this.initialized ||= this.database.prepare("CREATE TABLE IF NOT EXISTS vercel_artifacts (key TEXT PRIMARY KEY, content_base64 TEXT NOT NULL, content_type TEXT, custom_metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run().then(() => undefined); }
  async put(key: string, value: string | ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) {
    await this.ensure();
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
    const content = Buffer.from(bytes).toString("base64");
    await this.database.prepare("INSERT INTO vercel_artifacts (key, content_base64, content_type, custom_metadata) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET content_base64=excluded.content_base64, content_type=excluded.content_type, custom_metadata=excluded.custom_metadata, created_at=CURRENT_TIMESTAMP").bind(key, content, options?.httpMetadata?.contentType || "application/octet-stream", JSON.stringify(options?.customMetadata || {})).run();
    return { key };
  }
  async get(key: string) {
    await this.ensure();
    const row = await this.database.prepare("SELECT content_base64, content_type, custom_metadata FROM vercel_artifacts WHERE key = ?").bind(key).first<Record<string, unknown>>();
    if (!row) return null;
    const bytes = Buffer.from(String(row.content_base64), "base64");
    return { text: async () => bytes.toString("utf8"), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), httpMetadata: { contentType: String(row.content_type || "application/octet-stream") }, customMetadata: JSON.parse(String(row.custom_metadata || "{}")) };
  }
}

type RuntimeGlobal = typeof globalThis & { __worldmodelVercelEnv?: Record<string, unknown> };

export function vercelRuntimeEnv(environment: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch) {
  const global = globalThis as RuntimeGlobal;
  if (global.__worldmodelVercelEnv && environment === process.env && request === fetch) return global.__worldmodelVercelEnv;
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID?.trim();
  const databaseId = environment.CLOUDFLARE_D1_DATABASE_ID?.trim();
  const token = environment.CLOUDFLARE_D1_API_TOKEN?.trim();
  if (!accountId || !databaseId || !token) throw new Error("VERCEL_STORAGE_NOT_CONFIGURED: Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, and CLOUDFLARE_D1_API_TOKEN in Vercel before serving the application");
  const database = new RemoteD1(accountId, databaseId, token, request);
  const runtime = { ...environment, DB: database, ARTIFACTS: new D1ArtifactStore(database), VERCEL_RUNTIME: "true" };
  if (environment === process.env && request === fetch) global.__worldmodelVercelEnv = runtime;
  return runtime;
}
