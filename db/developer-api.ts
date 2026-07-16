import { recordAudit } from "./audit";
import { ensureSaasSchema, getSaasSnapshot, getWorkspaceEntitlements, requireRole, requireWriteEntitlement } from "./saas";
import { digestApiToken, generateApiTokenMaterial } from "../worldmodel/api-key-security.mjs";
import { getRuntimeEnv } from "@/server/runtime-env";

export const apiScopes = ["projects:read", "runs:read", "runs:write"] as const;
export type ApiScope = typeof apiScopes[number];

const RATE_LIMIT = 60;

async function getD1() {
  const env = await getRuntimeEnv();
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

function validScopes(scopes: string[]): scopes is ApiScope[] {
  return scopes.length > 0 && scopes.length === new Set(scopes).size && scopes.every((scope) => apiScopes.includes(scope as ApiScope));
}

export async function createApiKey(email: string, input: { name: string; scopes: string[]; expirationDays: number | null }) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  if (!validScopes(input.scopes)) throw new Error("Choose one or more supported API scopes");
  const db = await getD1();
  const workspaceId = String(snapshot.workspace.id);
  const active = await db.prepare("SELECT COUNT(*) AS count FROM api_keys WHERE workspace_id = ? AND status = 'active'").bind(workspaceId).first<{ count: number }>();
  requireWriteEntitlement(snapshot.entitlements);
  if (Number(active?.count || 0) >= snapshot.entitlements.limits.apiKeys) throw new Error(`${snapshot.entitlements.planName} plan API key limit reached`);
  const id = `key_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
  const { token, keyPrefix } = generateApiTokenMaterial(id);
  const keyHash = await digestApiToken(token);
  const expiresAt = input.expirationDays ? new Date(Date.now() + input.expirationDays * 24 * 60 * 60_000).toISOString() : null;
  await db.prepare("INSERT INTO api_keys (id, workspace_id, name, key_prefix, key_hash, scopes_json, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, workspaceId, input.name, keyPrefix, keyHash, JSON.stringify(input.scopes), email.toLowerCase(), expiresAt).run();
  await recordAudit({ workspaceId, actorEmail: email, action: "api_key.created", targetType: "api_key", targetId: id, summary: `Created API key: ${input.name}`, metadata: { scopes: input.scopes.join(","), expiresAt } });
  return { key: await db.prepare("SELECT id, name, key_prefix, scopes_json, status, created_by, last_used_at, expires_at, created_at, revoked_at FROM api_keys WHERE id = ?").bind(id).first(), token };
}

export async function revokeApiKey(email: string, keyId: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  const workspaceId = String(snapshot.workspace.id);
  const db = await getD1();
  const result = await db.prepare("UPDATE api_keys SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ? AND status = 'active'").bind(keyId, workspaceId).run();
  if (!result.meta.changes) throw new Error("Active API key not found");
  await recordAudit({ workspaceId, actorEmail: email, action: "api_key.revoked", targetType: "api_key", targetId: keyId, summary: "Revoked an API key" });
  return db.prepare("SELECT id, name, key_prefix, scopes_json, status, created_by, last_used_at, expires_at, created_at, revoked_at FROM api_keys WHERE id = ?").bind(keyId).first();
}

export class ApiAccessError extends Error {
  status: number;
  headers: Record<string, string>;
  constructor(message: string, status: number, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

export type ApiContext = { keyId: string; workspaceId: string; actor: string; scopes: ApiScope[]; rateHeaders: Record<string, string> };

export async function authenticateApiRequest(request: Request, requiredScope: ApiScope): Promise<ApiContext> {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token.startsWith("wm_live_") || token.length > 180) throw new ApiAccessError("A valid API bearer token is required", 401, { "www-authenticate": "Bearer" });
  await ensureSaasSchema();
  const db = await getD1();
  const keyHash = await digestApiToken(token);
  const key = await db.prepare("SELECT id, workspace_id, name, scopes_json FROM api_keys WHERE key_hash = ? AND status = 'active' AND (expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)").bind(keyHash).first<{ id: string; workspace_id: string; name: string; scopes_json: string }>();
  if (!key) throw new ApiAccessError("A valid API bearer token is required", 401, { "www-authenticate": "Bearer" });
  let scopes: ApiScope[];
  try { scopes = JSON.parse(key.scopes_json); }
  catch { throw new ApiAccessError("API key scopes are invalid", 401); }
  if (!scopes.includes(requiredScope)) throw new ApiAccessError(`API key requires the ${requiredScope} scope`, 403);
  const entitlements = await getWorkspaceEntitlements(key.workspace_id);
  if (entitlements.limits.apiKeys === 0) throw new ApiAccessError("Developer API access requires a paid plan or active trial", 402);
  if (requiredScope === "runs:write") {
    try { requireWriteEntitlement(entitlements); }
    catch (error) { throw new ApiAccessError(error instanceof Error ? error.message : "Write access is paused", 402); }
  }
  const bucketStart = `${new Date().toISOString().slice(0, 16)}:00Z`;
  const bucketId = `${key.id}:${bucketStart}`;
  await db.prepare("INSERT INTO api_rate_buckets (id, api_key_id, bucket_start, request_count) VALUES (?, ?, ?, 1) ON CONFLICT(api_key_id, bucket_start) DO UPDATE SET request_count = request_count + 1").bind(bucketId, key.id, bucketStart).run();
  const bucket = await db.prepare("SELECT request_count FROM api_rate_buckets WHERE api_key_id = ? AND bucket_start = ?").bind(key.id, bucketStart).first<{ request_count: number }>();
  const count = Number(bucket?.request_count || 1);
  if (count === 1) await db.prepare("DELETE FROM api_rate_buckets WHERE api_key_id = ? AND bucket_start < datetime('now', '-35 days')").bind(key.id).run();
  const reset = Math.floor(new Date(bucketStart).getTime() / 1000) + 60;
  const rateHeaders = { "x-ratelimit-limit": String(RATE_LIMIT), "x-ratelimit-remaining": String(Math.max(0, RATE_LIMIT - count)), "x-ratelimit-reset": String(reset) };
  if (count > RATE_LIMIT) throw new ApiAccessError("API rate limit exceeded", 429, { ...rateHeaders, "retry-after": String(Math.max(1, reset - Math.floor(Date.now() / 1000))) });
  await db.prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").bind(key.id).run();
  return { keyId: key.id, workspaceId: key.workspace_id, actor: `api-key:${key.id}`, scopes, rateHeaders };
}

export async function listApiProjects(workspaceId: string) {
  const db = await getD1();
  const rows = await db.prepare("SELECT id, name, repository, branch, source_kind, repository_verified, status, resilience_score, service_count, graph_json, scan_summary, scanned_at, updated_at FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 100").bind(workspaceId).all<Record<string, unknown>>();
  return rows.results.map((row) => {
    try { return { ...row, graph: JSON.parse(String(row.graph_json || "{}")), graph_json: undefined }; }
    catch { return { ...row, graph: { version: 1, nodes: [], edges: [] }, graph_json: undefined }; }
  });
}

export async function listApiRuns(workspaceId: string) {
  const db = await getD1();
  const rows = await db.prepare("SELECT r.id, r.project_id, p.name AS project_name, r.scenario, r.scenario_key, r.scenario_fingerprint, r.seed, r.status, r.evidence_kind, r.environment_id, r.journey_runner, r.environment_destroyed_at, r.before_score, r.after_score, r.before_error_rate, r.after_error_rate, r.before_latency_ms, r.after_latency_ms, r.before_journey_success, r.after_journey_success, r.before_service_health, r.after_service_health, r.verified_at, r.created_at FROM simulation_runs r JOIN projects p ON p.id = r.project_id WHERE p.workspace_id = ? ORDER BY r.created_at DESC LIMIT 100").bind(workspaceId).all();
  return rows.results;
}
