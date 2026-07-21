import { getRuntimeEnv, type RuntimeDatabase } from "./runtime-env.ts";

export type OidcClaims = { iss?: string; aud?: string | string[]; exp?: number; nbf?: number; repository?: string; ref?: string; workflow_ref?: string; event_name?: string };
type RunnerClaims = { workspaceId: string; projectId: string; runId: string; repository: string; exp: number; jti: string };

function decode(value: string) { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4); const binary = atob(padded); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
function encode(value: Uint8Array | string) { const binary = typeof value === "string" ? value : Array.from(value, (byte) => String.fromCharCode(byte)).join(""); return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
async function runtime() { return await getRuntimeEnv() as unknown as { DB: RuntimeDatabase; RUNNER_TOKEN_SECRET?: string }; }

async function verifyGithubJwt(token: string, audience: string) {
  const parts = token.split("."); if (parts.length !== 3) throw new Error("oidc_invalid: GitHub OIDC token is malformed");
  const header = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as { alg?: string; kid?: string };
  const claims = JSON.parse(new TextDecoder().decode(decode(parts[1]))) as OidcClaims;
  if (header.alg !== "RS256" || !header.kid || claims.iss !== "https://token.actions.githubusercontent.com") throw new Error("oidc_invalid: GitHub OIDC issuer or algorithm is invalid");
  const now = Math.floor(Date.now() / 1000), audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!claims.exp || claims.exp < now || (claims.nbf && claims.nbf > now + 30) || !audiences.includes(audience)) throw new Error("oidc_invalid: GitHub OIDC token is expired or has the wrong audience");
  const response = await fetch("https://token.actions.githubusercontent.com/.well-known/jwks"); if (!response.ok) throw new Error("oidc_unavailable: GitHub OIDC keys are unavailable");
  const keys = await response.json() as { keys?: Array<JsonWebKey & { kid?: string }> }; const jwk = keys.keys?.find((candidate) => candidate.kid === header.kid); if (!jwk) throw new Error("oidc_invalid: GitHub OIDC signing key was not found");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) throw new Error("oidc_invalid: GitHub OIDC signature is invalid");
  return claims;
}

async function runnerKey(secret: string, use: KeyUsage[]) { return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, use); }

export function expectedRunnerWorkflowRef(repository: string, branch: string, projectId: string) {
  return `${repository}/.github/workflows/worldmodel-${projectId}.yml@refs/heads/${branch}`;
}

export function runnerOidcClaimsMatch(claims: OidcClaims, input: { repository: string; branch: string; projectId: string }) {
  if (claims.repository?.toLowerCase() !== input.repository.toLowerCase()) return false;
  if (claims.ref !== `refs/heads/${input.branch}` || claims.event_name !== "workflow_dispatch") return false;
  return claims.workflow_ref === expectedRunnerWorkflowRef(claims.repository, input.branch, input.projectId);
}

export async function exchangeRunnerOidc(input: { oidcToken: string; audience: string; projectId: string; runId: string }) {
  const env = await runtime(); if (!env.RUNNER_TOKEN_SECRET) throw new Error("runner_not_configured: RUNNER_TOKEN_SECRET is missing");
  const claims = await verifyGithubJwt(input.oidcToken, input.audience);
  const record = await env.DB.prepare("SELECT p.workspace_id, p.repository, p.branch, cr.status FROM projects p JOIN campaign_runs cr ON cr.project_id = p.id WHERE p.id = ? AND cr.id = ? LIMIT 1").bind(input.projectId, input.runId).first<{ workspace_id: string; repository: string; branch: string; status: string }>();
  if (!record || !["queued", "running", "cancellation_requested"].includes(record.status)) throw new Error("run_not_found: Campaign run is not accepting evidence");
  if (!runnerOidcClaimsMatch(claims, { repository: record.repository, branch: record.branch, projectId: input.projectId })) throw new Error("oidc_unauthorized: GitHub repository, branch, event, or workflow does not match this project");
  const runner: RunnerClaims = { workspaceId: record.workspace_id, projectId: input.projectId, runId: input.runId, repository: record.repository, exp: Math.floor(Date.now() / 1000) + 900, jti: crypto.randomUUID() };
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" })), payload = encode(JSON.stringify(runner));
  const signature = await crypto.subtle.sign("HMAC", await runnerKey(env.RUNNER_TOKEN_SECRET, ["sign"]), new TextEncoder().encode(`${header}.${payload}`));
  return { token: `${header}.${payload}.${encode(new Uint8Array(signature))}`, expiresAt: new Date(runner.exp * 1000).toISOString() };
}

export async function acceptRunnerEvidence(token: string, raw: string) {
  const env = await runtime(); if (!env.RUNNER_TOKEN_SECRET) throw new Error("runner_not_configured: RUNNER_TOKEN_SECRET is missing");
  const parts = token.split("."); if (parts.length !== 3) throw new Error("runner_unauthorized: Run token is malformed");
  const valid = await crypto.subtle.verify("HMAC", await runnerKey(env.RUNNER_TOKEN_SECRET, ["verify"]), decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new Error("runner_unauthorized: Run token signature is invalid");
  const claims = JSON.parse(new TextDecoder().decode(decode(parts[1]))) as RunnerClaims; if (claims.exp < Math.floor(Date.now() / 1000)) throw new Error("runner_unauthorized: Run token has expired");
  const evidence = JSON.parse(raw) as { scenarioFingerprint?: string; seed?: string; environmentDestroyedAt?: string };
  const run = await env.DB.prepare("SELECT scenario_json FROM campaign_runs WHERE id = ? AND workspace_id = ? AND project_id = ?").bind(claims.runId, claims.workspaceId, claims.projectId).first<{ scenario_json: string }>();
  if (!run) throw new Error("run_not_found: Campaign run was not found"); const scenario = JSON.parse(run.scenario_json) as { seed?: string };
  const hexFingerprint = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(scenario))))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (evidence.scenarioFingerprint !== hexFingerprint || evidence.seed !== scenario.seed || !evidence.environmentDestroyedAt || Number.isNaN(Date.parse(evidence.environmentDestroyedAt))) throw new Error("evidence_invalid: Fingerprint, seed, and teardown attestation must match the immutable scenario");
  if (/gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\"(?:password|token|secret|apiKey)\"\s*:\s*\"(?!\[REDACTED\])/i.test(raw)) throw new Error("evidence_invalid: Evidence contains an unredacted credential pattern");
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS runner_callbacks (run_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, token_jti TEXT NOT NULL UNIQUE, evidence_json TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await env.DB.prepare("INSERT INTO runner_callbacks (run_id, workspace_id, project_id, token_jti, evidence_json) VALUES (?, ?, ?, ?, ?)").bind(claims.runId, claims.workspaceId, claims.projectId, claims.jti, raw).run();
  return { runId: claims.runId, accepted: true };
}
