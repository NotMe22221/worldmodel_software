import { getRuntimeEnv, type RuntimeDatabase } from "./runtime-env.ts";
import {
  immutableScenario,
  normalizeCampaignRunnerEvidence,
  normalizeExecutionManifest,
  sha256Hex,
  type CampaignRunnerEvidence,
} from "../worldmodel/runner-evidence.ts";
import {
  requireVerifiedRunnerWorkflowRevision,
  type RunnerWorkflowVerifier,
} from "../worldmodel/runner-auth.ts";

export type OidcClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  repository?: string;
  ref?: string;
  workflow_ref?: string;
  workflow_sha?: string;
  event_name?: string;
};

type RunnerClaims = {
  workspaceId: string;
  projectId: string;
  runId: string;
  repository: string;
  iat: number;
  exp: number;
  jti: string;
};

type CampaignRunRecord = {
  campaign_id: string;
  workspace_id: string;
  project_id: string;
  scenario_json: string;
  status: string;
  simulation_run_id: string | null;
  created_at: string;
  campaign_status: string;
  repository: string;
  branch: string;
  repository_verified: number;
};

type StoredObservedRun = {
  id: string;
  project_id: string;
  status: string;
  evidence_kind: string;
  scenario_fingerprint: string | null;
  seed: string | null;
  attestation_json: string | null;
};

const runnerRunStates = new Set(["queued", "running", "cancellation_requested"]);
const runnerCampaignStates = new Set(["dispatching", "queued", "running", "cancellation_requested"]);
const secretPattern = /gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|"(?:password|token|secret|apiKey)"\s*:\s*"(?!\[REDACTED\])/i;
const runnerId = /^[A-Za-z][A-Za-z0-9_-]{2,120}$/;
const repositoryName = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const maximumEvidenceBytes = 5_000_000;
const maximumScenarioBytes = 100_000;
const maximumManifestBytes = 100_000;
const githubJwksTtlMs = 5 * 60_000;
const githubJwksTimeoutMs = 5_000;
const githubJwksRefreshCooldownMs = 60_000;
const minimumRunnerTokenSecretBytes = 32;
type GithubJwk = JsonWebKey & { kid?: string };
let githubJwksCache: { keys: GithubJwk[]; expiresAt: number } | undefined;
let githubJwksRequest: Promise<GithubJwk[]> | undefined;
let githubJwksLastForcedRefreshAt = 0;

function decode(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encode(value: Uint8Array | string) {
  const binary = typeof value === "string" ? value : Array.from(value, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function runtime() {
  return await getRuntimeEnv() as unknown as { DB: RuntimeDatabase; RUNNER_TOKEN_SECRET?: string };
}

function parseBoundedJson(raw: string, label: string, maximumBytes: number) {
  if (typeof raw !== "string" || !raw || new TextEncoder().encode(raw).byteLength > maximumBytes) throw new Error(`${label}: JSON is missing or exceeds its size limit`);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label}: JSON is malformed`);
  }
}

async function githubJwks(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && githubJwksCache && githubJwksCache.expiresAt > now) return githubJwksCache.keys;
  if (githubJwksRequest) return githubJwksRequest;
  if (forceRefresh && githubJwksCache && now - githubJwksLastForcedRefreshAt < githubJwksRefreshCooldownMs) return githubJwksCache.keys;
  if (forceRefresh) githubJwksLastForcedRefreshAt = now;
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), githubJwksTimeoutMs);
    try {
      const response = await fetch("https://token.actions.githubusercontent.com/.well-known/jwks", {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("unavailable");
      const value = await response.json() as { keys?: GithubJwk[] };
      if (!Array.isArray(value.keys) || value.keys.length === 0 || value.keys.length > 100) throw new Error("invalid keys");
      githubJwksCache = { keys: value.keys, expiresAt: Date.now() + githubJwksTtlMs };
      return value.keys;
    } catch {
      throw new Error("oidc_unavailable: GitHub OIDC keys are unavailable");
    } finally {
      clearTimeout(timeout);
    }
  })();
  githubJwksRequest = request;
  try {
    return await request;
  } finally {
    if (githubJwksRequest === request) githubJwksRequest = undefined;
  }
}

async function verifyGithubJwt(token: string, audience: string) {
  if (!token || token.length > 16_384) throw new Error("oidc_invalid: GitHub OIDC token is malformed");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("oidc_invalid: GitHub OIDC token is malformed");
  let header: { alg?: string; kid?: string };
  let claims: OidcClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as { alg?: string; kid?: string };
    claims = JSON.parse(new TextDecoder().decode(decode(parts[1]))) as OidcClaims;
  } catch {
    throw new Error("oidc_invalid: GitHub OIDC token is malformed");
  }
  if (header.alg !== "RS256" || !header.kid || header.kid.length > 200 || claims.iss !== "https://token.actions.githubusercontent.com") throw new Error("oidc_invalid: GitHub OIDC issuer or algorithm is invalid");
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!Number.isInteger(claims.exp) || Number(claims.exp) < now || (claims.nbf != null && (!Number.isInteger(claims.nbf) || claims.nbf > now + 30)) || !audiences.includes(audience)) throw new Error("oidc_invalid: GitHub OIDC token is expired or has the wrong audience");
  const usedExistingCache = Boolean(githubJwksCache && githubJwksCache.expiresAt > Date.now());
  let keys = await githubJwks();
  let jwk = keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk && usedExistingCache) {
    keys = await githubJwks(true);
    jwk = keys.find((candidate) => candidate.kid === header.kid);
  }
  if (!jwk) throw new Error("oidc_invalid: GitHub OIDC signing key was not found");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new Error("oidc_invalid: GitHub OIDC signature is invalid");
  return claims;
}

async function runnerKey(secret: string, use: KeyUsage[]) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, use);
}

export function requiredRunnerTokenSecret(value: string | undefined) {
  const secret = value?.trim() || "";
  if (new TextEncoder().encode(secret).byteLength < minimumRunnerTokenSecretBytes) {
    throw new Error("runner_not_configured: RUNNER_TOKEN_SECRET must contain at least 32 UTF-8 bytes");
  }
  return secret;
}

function validateRunnerClaims(value: unknown): RunnerClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("runner_unauthorized: Run token claims are malformed");
  const claims = value as Partial<RunnerClaims>;
  const keys = Object.keys(claims);
  const expected = ["workspaceId", "projectId", "runId", "repository", "iat", "exp", "jti"];
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) throw new Error("runner_unauthorized: Run token claims are malformed");
  if (typeof claims.workspaceId !== "string" || !runnerId.test(claims.workspaceId) || typeof claims.projectId !== "string" || !runnerId.test(claims.projectId) || typeof claims.runId !== "string" || !runnerId.test(claims.runId)) throw new Error("runner_unauthorized: Run token scope is malformed");
  if (typeof claims.repository !== "string" || !repositoryName.test(claims.repository) || typeof claims.jti !== "string" || !uuid.test(claims.jti)) throw new Error("runner_unauthorized: Run token identity is malformed");
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.iat !== "number" || typeof claims.exp !== "number" || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > now + 30 || claims.exp - claims.iat !== 900 || claims.exp <= now) throw new Error("runner_unauthorized: Run token has expired or has an invalid lifetime");
  return claims as RunnerClaims;
}

async function verifyRunnerToken(token: string, secret: string) {
  if (!token || token.length > 4_096) throw new Error("runner_unauthorized: Run token is malformed");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("runner_unauthorized: Run token is malformed");
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", await runnerKey(secret, ["verify"]), decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch {
    throw new Error("runner_unauthorized: Run token is malformed");
  }
  if (!valid) throw new Error("runner_unauthorized: Run token signature is invalid");
  try {
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as Record<string, unknown>;
    const headerKeys = Object.keys(header);
    if (headerKeys.length !== 2 || header.alg !== "HS256" || header.typ !== "JWT") throw new Error("invalid header");
    return validateRunnerClaims(JSON.parse(new TextDecoder().decode(decode(parts[1]))));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("runner_unauthorized:")) throw error;
    throw new Error("runner_unauthorized: Run token claims are malformed");
  }
}

async function campaignRun(db: RuntimeDatabase, claims: Pick<RunnerClaims, "workspaceId" | "projectId" | "runId">) {
  return db.prepare(`
    SELECT cr.campaign_id, cr.workspace_id, cr.project_id, cr.scenario_json, cr.status, cr.simulation_run_id, cr.created_at,
           c.status AS campaign_status, p.repository, p.branch, p.repository_verified
    FROM campaign_runs cr
    JOIN campaigns c ON c.id = cr.campaign_id AND c.workspace_id = cr.workspace_id AND c.project_id = cr.project_id
    JOIN projects p ON p.id = cr.project_id AND p.workspace_id = cr.workspace_id
    WHERE cr.id = ? AND cr.workspace_id = ? AND cr.project_id = ?
    LIMIT 1
  `).bind(claims.runId, claims.workspaceId, claims.projectId).first<CampaignRunRecord>();
}

export function expectedRunnerWorkflowRef(repository: string, branch: string, projectId: string) {
  return `${repository}/.github/workflows/worldmodel-${projectId}.yml@refs/heads/${branch}`;
}

export function runnerOidcClaimsMatch(claims: OidcClaims, input: { repository: string; branch: string; projectId: string }) {
  if (claims.repository?.toLowerCase() !== input.repository.toLowerCase()) return false;
  if (claims.ref !== `refs/heads/${input.branch}` || claims.event_name !== "workflow_dispatch") return false;
  if (!/^[a-f0-9]{40}$/i.test(claims.workflow_sha || "")) return false;
  return claims.workflow_ref === expectedRunnerWorkflowRef(claims.repository, input.branch, input.projectId);
}

export async function exchangeRunnerOidc(
  input: { oidcToken: string; audience: string; projectId: string; runId: string },
  verifyWorkflow?: RunnerWorkflowVerifier,
) {
  const env = await runtime();
  const runnerSecret = requiredRunnerTokenSecret(env.RUNNER_TOKEN_SECRET);
  if (!runnerId.test(input.projectId) || !runnerId.test(input.runId) || input.audience.length > 2_000) throw new Error("request_invalid: Project, run, or audience is invalid");
  const claims = await verifyGithubJwt(input.oidcToken, input.audience);
  // GitHub's signed repository/workflow claims provide the tenant scope for this
  // one lookup; the minted runner token carries the resolved workspace thereafter.
  const unscoped = await env.DB.prepare(`
    SELECT cr.campaign_id, cr.workspace_id, cr.project_id, cr.scenario_json, cr.status, cr.simulation_run_id, cr.created_at,
           c.status AS campaign_status, p.repository, p.branch, p.repository_verified
    FROM campaign_runs cr
    JOIN campaigns c ON c.id = cr.campaign_id AND c.workspace_id = cr.workspace_id AND c.project_id = cr.project_id
    JOIN projects p ON p.id = cr.project_id AND p.workspace_id = cr.workspace_id
    WHERE cr.id = ? AND cr.project_id = ?
    LIMIT 1
  `).bind(input.runId, input.projectId).first<CampaignRunRecord>();
  if (!unscoped || !runnerRunStates.has(unscoped.status) || !runnerCampaignStates.has(unscoped.campaign_status) || unscoped.repository_verified !== 1) throw new Error("run_not_found: Campaign run is not accepting evidence");
  if (!runnerOidcClaimsMatch(claims, { repository: unscoped.repository, branch: unscoped.branch, projectId: input.projectId })) throw new Error("oidc_unauthorized: GitHub repository, branch, event, or workflow does not match this project");

  const immutable = await immutableScenario(parseBoundedJson(unscoped.scenario_json, "scenario_invalid", maximumScenarioBytes));
  const executionBasis = await env.DB.prepare(`
    SELECT er.id AS environment_id, er.backend, er.manifest_json,
           mv.id AS model_id, mv.commit_sha
    FROM environment_revisions er
    JOIN model_versions mv ON mv.id = er.model_version_id
      AND mv.workspace_id = er.workspace_id AND mv.project_id = er.project_id
      AND mv.status = 'approved'
    WHERE er.id = ? AND er.workspace_id = ? AND er.project_id = ?
      AND er.model_version_id = ? AND er.status = 'approved'
    LIMIT 1
  `).bind(immutable.scenario.environmentRevisionId, unscoped.workspace_id, input.projectId, immutable.scenario.modelVersionId).first<{
    environment_id: string;
    backend: string;
    manifest_json: string;
    model_id: string;
    commit_sha: string;
  }>();
  if (!executionBasis || executionBasis.backend !== "github_actions" || !/^[a-f0-9]{40}$/i.test(executionBasis.commit_sha)) throw new Error("run_not_ready: The run is not bound to an approved GitHub Actions environment and immutable model commit");
  const manifest = normalizeExecutionManifest(parseBoundedJson(executionBasis.manifest_json, "manifest_invalid", maximumManifestBytes));
  await requireVerifiedRunnerWorkflowRevision({
    db: env.DB,
    workspaceId: unscoped.workspace_id,
    projectId: input.projectId,
    repository: unscoped.repository,
    workflowSha: claims.workflow_sha as string,
    apiOrigin: new URL(input.audience).origin,
  }, verifyWorkflow);
  const issuedAt = Math.floor(Date.now() / 1000);
  const runner: RunnerClaims = {
    workspaceId: unscoped.workspace_id,
    projectId: input.projectId,
    runId: input.runId,
    repository: unscoped.repository,
    iat: issuedAt,
    exp: issuedAt + 900,
    jti: crypto.randomUUID(),
  };
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encode(JSON.stringify(runner));
  const signature = await crypto.subtle.sign("HMAC", await runnerKey(runnerSecret, ["sign"]), new TextEncoder().encode(`${header}.${payload}`));
  return {
    token: `${header}.${payload}.${encode(new Uint8Array(signature))}`,
    expiresAt: new Date(runner.exp * 1000).toISOString(),
    execution: {
      projectId: input.projectId,
      runId: input.runId,
      repository: { fullName: unscoped.repository, branch: unscoped.branch },
      scenario: immutable.scenario,
      scenarioFingerprint: immutable.fingerprint,
      environment: { id: executionBasis.environment_id, backend: "github_actions" as const, manifest },
      model: { id: executionBasis.model_id, commitSha: executionBasis.commit_sha.toLowerCase() },
    },
  };
}

function observedRunId(claims: RunnerClaims) {
  return sha256Hex(`observed:${claims.workspaceId}:${claims.projectId}:${claims.runId}`).then((digest) => `run_observed_${digest.slice(0, 32)}`);
}

function eventIds(simulationRunId: string) {
  const suffix = simulationRunId.slice("run_observed_".length);
  return { verification: `event_${suffix}_verified`, terminal: `event_${suffix}_terminal` };
}

function percent(value: number) {
  return `${value}%`;
}

async function persistedReplay(
  db: RuntimeDatabase,
  claims: RunnerClaims,
  simulationRunId: string,
  evidenceJson: string,
  events: ReturnType<typeof eventIds>,
  scenarioFingerprint: string,
  seed: string,
) {
  const run = await campaignRun(db, claims);
  if (!run?.simulation_run_id) return null;
  const [callback, simulation, storedEvents] = await Promise.all([
    db.prepare("SELECT evidence_json FROM runner_callbacks WHERE run_id = ? AND workspace_id = ? AND project_id = ?").bind(claims.runId, claims.workspaceId, claims.projectId).first<{ evidence_json: string }>(),
    db.prepare("SELECT id, project_id, status, evidence_kind, scenario_fingerprint, seed, attestation_json FROM simulation_runs WHERE id = ? AND project_id = ?").bind(run.simulation_run_id, claims.projectId).first<StoredObservedRun>(),
    db.prepare("SELECT id FROM run_events WHERE run_id = ? AND workspace_id = ? AND project_id = ? AND id IN (?, ?)").bind(claims.runId, claims.workspaceId, claims.projectId, events.verification, events.terminal).all<{ id: string }>(),
  ]);
  if (callback && callback.evidence_json !== evidenceJson) throw new Error("evidence_conflict: This campaign run already has different observed evidence");
  const valid = run.simulation_run_id === simulationRunId
    && (run.status === "completed" || run.status === "cancelled")
    && callback?.evidence_json === evidenceJson
    && simulation?.id === simulationRunId
    && simulation.project_id === claims.projectId
    && simulation.status === "verified"
    && simulation.evidence_kind === "observed"
    && simulation.scenario_fingerprint === scenarioFingerprint
    && simulation.seed === seed
    && simulation.attestation_json === evidenceJson
    && storedEvents.results.length === 2;
  if (!valid) throw new Error("evidence_integrity_error: Campaign evidence linkage is incomplete or inconsistent");
  return { runId: claims.runId, simulationRunId, status: run.status as "completed" | "cancelled", accepted: true as const, duplicate: true as const };
}

export async function acceptRunnerEvidence(token: string, raw: string) {
  const env = await runtime();
  const runnerSecret = requiredRunnerTokenSecret(env.RUNNER_TOKEN_SECRET);
  const claims = await verifyRunnerToken(token, runnerSecret);
  // Product schema initialization historically omitted this migration-backed
  // table, so retain a safe lazy create at the callback boundary.
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS runner_callbacks (run_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, token_jti TEXT NOT NULL UNIQUE, evidence_json TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  const run = await campaignRun(env.DB, claims);
  if (!run) throw new Error("run_not_found: Campaign run was not found");
  if (run.repository.toLowerCase() !== claims.repository.toLowerCase()) throw new Error("runner_unauthorized: Run token repository no longer matches the project");
  const immutable = await immutableScenario(parseBoundedJson(run.scenario_json, "scenario_invalid", maximumScenarioBytes));
  const payload = parseBoundedJson(raw, "evidence_invalid", maximumEvidenceBytes);
  if (secretPattern.test(raw)) throw new Error("evidence_invalid: Evidence contains an unredacted credential pattern");
  const normalized = normalizeCampaignRunnerEvidence(payload, {
    projectId: claims.projectId,
    scenario: immutable.scenario,
    fingerprint: immutable.fingerprint,
  });
  const runCreatedAt = Date.parse(run.created_at.includes("T") ? run.created_at : `${run.created_at.replace(" ", "T")}Z`);
  if (!Number.isFinite(runCreatedAt) || Date.parse(normalized.journey.startedAt) < runCreatedAt - 5 * 60_000) throw new Error("evidence_invalid: Playwright execution predates the authorized campaign run");
  const { durationSeconds, ...evidence } = normalized;
  const canonicalEvidence = evidence as CampaignRunnerEvidence;
  const evidenceJson = JSON.stringify(canonicalEvidence);
  const simulationRunId = await observedRunId(claims);
  const events = eventIds(simulationRunId);
  if (run.simulation_run_id) return await persistedReplay(env.DB, claims, simulationRunId, evidenceJson, events, immutable.fingerprint, immutable.scenario.seed);
  if (!runnerRunStates.has(run.status) || !runnerCampaignStates.has(run.campaign_status)) throw new Error("run_not_found: Campaign run is not accepting evidence");

  const existingCallback = await env.DB.prepare("SELECT evidence_json FROM runner_callbacks WHERE run_id = ?").bind(claims.runId).first<{ evidence_json: string }>();
  if (existingCallback && existingCallback.evidence_json !== evidenceJson) throw new Error("evidence_conflict: This campaign run already has different observed evidence");
  const replayIdentity = await env.DB.prepare("SELECT id FROM simulation_runs WHERE project_id = ? AND scenario_fingerprint = ? AND seed = ? AND evidence_kind = 'observed' LIMIT 1").bind(claims.projectId, immutable.fingerprint, immutable.scenario.seed).first<{ id: string }>();
  if (replayIdentity) throw new Error("evidence_conflict: This immutable scenario and seed already have observed evidence");

  const verifiedAt = new Date().toISOString();
  const verificationPayload = JSON.stringify({
    scenarioFingerprint: immutable.fingerprint,
    seed: immutable.scenario.seed,
    before: canonicalEvidence.before,
    after: canonicalEvidence.after,
    journey: {
      id: canonicalEvidence.journey.id,
      runner: canonicalEvidence.journey.runner,
      startedAt: canonicalEvidence.journey.startedAt,
      endedAt: canonicalEvidence.journey.endedAt,
    },
  });
  const terminalPayload = JSON.stringify({ environment: canonicalEvidence.environment });
  const statements = [
    env.DB.prepare(`
      UPDATE campaign_runs
      SET status = CASE WHEN status = 'cancellation_requested' THEN 'cancelled' ELSE 'completed' END,
          simulation_run_id = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND project_id = ?
        AND simulation_run_id IS NULL
        AND status IN ('queued', 'running', 'cancellation_requested')
    `).bind(simulationRunId, verifiedAt, claims.runId, claims.workspaceId, claims.projectId),
    env.DB.prepare(`
      INSERT INTO simulation_runs (
        id, project_id, scenario, status, before_score, after_score, error_rate, latency_ms,
        journey_success, duration_seconds, scenario_key, scenario_fingerprint, seed,
        before_error_rate, after_error_rate, before_latency_ms, after_latency_ms,
        before_journey_success, after_journey_success, verified_at, evidence_kind,
        environment_id, journey_runner, environment_destroyed_at,
        before_service_health, after_service_health, attestation_json
      )
      SELECT ?, cr.project_id, ?, 'verified', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'observed', ?, 'playwright', ?, ?, ?, ?
      FROM campaign_runs cr
      WHERE cr.id = ? AND cr.workspace_id = ? AND cr.project_id = ? AND cr.simulation_run_id = ?
    `).bind(
      simulationRunId,
      immutable.scenario.name,
      canonicalEvidence.before.resilienceScore,
      canonicalEvidence.after.resilienceScore,
      percent(canonicalEvidence.after.errorRate),
      canonicalEvidence.after.latencyMs,
      canonicalEvidence.after.journeySuccess,
      durationSeconds,
      immutable.fingerprint,
      immutable.scenario.seed,
      percent(canonicalEvidence.before.errorRate),
      percent(canonicalEvidence.after.errorRate),
      canonicalEvidence.before.latencyMs,
      canonicalEvidence.after.latencyMs,
      canonicalEvidence.before.journeySuccess,
      canonicalEvidence.after.journeySuccess,
      verifiedAt,
      canonicalEvidence.environment.id,
      canonicalEvidence.environment.destroyedAt,
      canonicalEvidence.before.serviceHealth,
      canonicalEvidence.after.serviceHealth,
      evidenceJson,
      claims.runId,
      claims.workspaceId,
      claims.projectId,
      simulationRunId,
    ),
    ...(!existingCallback ? [env.DB.prepare(`
      INSERT INTO runner_callbacks (run_id, workspace_id, project_id, token_jti, evidence_json, received_at)
      SELECT cr.id, cr.workspace_id, cr.project_id, ?, ?, ?
      FROM campaign_runs cr
      WHERE cr.id = ? AND cr.workspace_id = ? AND cr.project_id = ? AND cr.simulation_run_id = ?
    `).bind(claims.jti, evidenceJson, verifiedAt, claims.runId, claims.workspaceId, claims.projectId, simulationRunId)] : []),
    env.DB.prepare(`
      INSERT INTO run_events (id, workspace_id, project_id, run_id, sequence, type, source, service_id, journey_id, payload_json, evidence_ref, created_at)
      SELECT ?, cr.workspace_id, cr.project_id, cr.id,
             COALESCE((SELECT MAX(existing.sequence) FROM run_events existing WHERE existing.run_id = cr.id), 0) + 1,
             'verification.completed', 'github_actions', NULL, ?, ?, ?, ?
      FROM campaign_runs cr
      WHERE cr.id = ? AND cr.workspace_id = ? AND cr.project_id = ? AND cr.simulation_run_id = ?
    `).bind(events.verification, canonicalEvidence.journey.id, verificationPayload, simulationRunId, canonicalEvidence.journey.endedAt, claims.runId, claims.workspaceId, claims.projectId, simulationRunId),
    env.DB.prepare(`
      INSERT INTO run_events (id, workspace_id, project_id, run_id, sequence, type, source, service_id, journey_id, payload_json, evidence_ref, created_at)
      SELECT ?, cr.workspace_id, cr.project_id, cr.id,
             COALESCE((SELECT MAX(existing.sequence) FROM run_events existing WHERE existing.run_id = cr.id), 0) + 1,
             CASE WHEN cr.status = 'cancelled' THEN 'run.cancelled' ELSE 'run.completed' END,
             'github_actions', NULL, ?, ?, ?, ?
      FROM campaign_runs cr
      WHERE cr.id = ? AND cr.workspace_id = ? AND cr.project_id = ? AND cr.simulation_run_id = ?
    `).bind(events.terminal, canonicalEvidence.journey.id, terminalPayload, simulationRunId, canonicalEvidence.environment.destroyedAt, claims.runId, claims.workspaceId, claims.projectId, simulationRunId),
    env.DB.prepare(`
      UPDATE campaigns
      SET status = CASE
        WHEN status IN ('completed', 'cancelled', 'failed') THEN status
        WHEN EXISTS (SELECT 1 FROM campaign_runs child WHERE child.campaign_id = campaigns.id AND child.status NOT IN ('completed', 'cancelled', 'failed'))
          THEN CASE WHEN status = 'cancellation_requested' THEN 'cancellation_requested' ELSE 'running' END
        WHEN status = 'cancellation_requested' THEN 'cancelled'
        WHEN EXISTS (SELECT 1 FROM campaign_runs child WHERE child.campaign_id = campaigns.id AND child.status = 'failed') THEN 'failed'
        WHEN EXISTS (SELECT 1 FROM campaign_runs child WHERE child.campaign_id = campaigns.id AND child.status = 'cancelled') THEN 'cancelled'
        ELSE 'completed'
      END,
      updated_at = ?
      WHERE id = ? AND workspace_id = ? AND project_id = ?
    `).bind(verifiedAt, run.campaign_id, claims.workspaceId, claims.projectId),
  ];

  try {
    await env.DB.batch(statements);
  } catch {
    const replay = await persistedReplay(env.DB, claims, simulationRunId, evidenceJson, events, immutable.fingerprint, immutable.scenario.seed);
    if (replay) return replay;
    const collision = await env.DB.prepare("SELECT id FROM simulation_runs WHERE project_id = ? AND scenario_fingerprint = ? AND seed = ? AND evidence_kind = 'observed' LIMIT 1").bind(claims.projectId, immutable.fingerprint, immutable.scenario.seed).first();
    if (collision) throw new Error("evidence_conflict: This immutable scenario and seed already have observed evidence");
    throw new Error("evidence_persistence_failed: Observed evidence could not be stored atomically");
  }
  const stored = await persistedReplay(env.DB, claims, simulationRunId, evidenceJson, events, immutable.fingerprint, immutable.scenario.seed);
  if (!stored) throw new Error("evidence_persistence_failed: Observed evidence did not advance the campaign run");
  return { ...stored, duplicate: false as const };
}
