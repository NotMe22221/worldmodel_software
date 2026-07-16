import { DurableObject, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { candidateScore, validateCampaign, validateManifest, type CampaignPlan, type RunEventType, type WorldModelManifest } from "../worldmodel/product-contracts";
import type { RepositorySource } from "../server/composio";

type RunnerBinding = { fetch(request: Request): Promise<Response> };
type D1Result<T> = { results: T[] };
type D1Statement = { bind(...values: unknown[]): D1Statement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<D1Result<T>>; run(): Promise<{ success: boolean }> };
type D1 = { prepare(query: string): D1Statement; batch(statements: D1Statement[]): Promise<Array<{ success: boolean }>> };
type R2 = { put(key: string, value: string | ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown> };
type EventHubNamespace = { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };

export type ControlEnv = {
  DB: D1;
  ARTIFACTS: R2;
  RUN_EVENTS: EventHubNamespace;
  SANDBOX_RUNNER?: RunnerBinding;
  GITHUB_ACTIONS_RUNNER?: RunnerBinding;
  REPAIR_RUNNER?: RunnerBinding;
  SCAN_RUNNER?: RunnerBinding;
  RUNNER_EVIDENCE_SECRET?: string;
};

type CampaignParams = { campaignId: string; workspaceId: string; projectId: string; backend: string; repository: string; branch: string; repositorySource: RepositorySource; commitSha: string; manifest: WorldModelManifest; plan: CampaignPlan };
type RepairParams = { investigationId: string; workspaceId: string; projectId: string; runId: string; objective: string };
type ScanParams = { scanId: string; workspaceId: string; projectId: string; repository: string; branch: string; repositorySource: RepositorySource; commitSha?: string };
type RunnerEvidence = { status: "completed" | "failed"; before?: { score: number; errorRate: string; latencyMs: number; journeySuccess: number; serviceHealth: number }; after?: { score: number; errorRate: string; latencyMs: number; journeySuccess: number; serviceHealth: number }; scenarioFingerprint: string; seed: string; environmentId?: string; environmentDestroyedAt: string; startedAt: string; endedAt: string; events: Array<{ type: RunEventType; source: string; serviceId?: string; journeyId?: string; payload?: Record<string, unknown> }>; logs?: string; error?: string };

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyEvidence(body: string, signature: string | null, secret: string | undefined) {
  if (!secret) throw new Error("Runner evidence secret is not configured");
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) throw new Error("Runner evidence signature is missing");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g) || [], (pair) => Number.parseInt(pair, 16));
  if (!await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(body))) throw new Error("Runner evidence signature is invalid");
}

async function appendEvent(env: ControlEnv, input: { workspaceId: string; projectId: string; runId: string; type: RunEventType; source: string; serviceId?: string; journeyId?: string; payload?: Record<string, unknown>; evidenceRef?: string }) {
  const sequenceRow = await env.DB.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_events WHERE run_id = ?").bind(input.runId).first<{ sequence: number }>();
  const sequence = Number(sequenceRow?.sequence || 1);
  const event = { sequence, type: input.type, timestamp: new Date().toISOString(), source: input.source, serviceId: input.serviceId, journeyId: input.journeyId, payload: input.payload || {}, evidenceRef: input.evidenceRef };
  await env.DB.prepare("INSERT INTO run_events (id, workspace_id, project_id, run_id, sequence, type, source, service_id, journey_id, payload_json, evidence_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(newId("evt"), input.workspaceId, input.projectId, input.runId, sequence, input.type, input.source, input.serviceId || null, input.journeyId || null, JSON.stringify(input.payload || {}), input.evidenceRef || null, event.timestamp).run();
  const hub = env.RUN_EVENTS.get(env.RUN_EVENTS.idFromName(input.runId));
  await hub.fetch(new Request("https://events.internal/publish", { method: "POST", body: JSON.stringify(event) }));
  return event;
}

async function executeOne(env: ControlEnv, params: CampaignParams, campaignRun: { id: string; scenario_json: string }, manifest: WorldModelManifest) {
  const runner = params.backend === "github_actions" ? env.GITHUB_ACTIONS_RUNNER : env.SANDBOX_RUNNER;
  if (!runner) throw new Error(`${params.backend} runner binding is not configured`);
  const scenario = JSON.parse(campaignRun.scenario_json);
  await env.DB.prepare("UPDATE campaign_runs SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(campaignRun.id, params.workspaceId).run();
  await appendEvent(env, { workspaceId: params.workspaceId, projectId: params.projectId, runId: campaignRun.id, type: "run.created", source: "control-plane", payload: { campaignId: params.campaignId, backend: params.backend } });
  const scenarioFingerprint = await sha256(JSON.stringify(scenario));
  const response = await runner.fetch(new Request("https://runner.internal/v1/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: params.workspaceId, projectId: params.projectId, campaignId: params.campaignId, runId: campaignRun.id, repository: params.repository, branch: params.branch, repositorySource: params.repositorySource, commitSha: params.commitSha, manifest, scenario, scenarioFingerprint }) }));
  const raw = await response.text();
  if (!response.ok) throw new Error(`Runner returned ${response.status}: ${raw.slice(0, 300)}`);
  await verifyEvidence(raw, response.headers.get("x-worldmodel-signature"), env.RUNNER_EVIDENCE_SECRET);
  const evidence = JSON.parse(raw) as RunnerEvidence;
  if (!evidence.environmentDestroyedAt || evidence.seed !== scenario.seed || evidence.scenarioFingerprint !== scenarioFingerprint) throw new Error("Runner evidence does not match the immutable scenario or teardown contract");
  for (const item of evidence.events.slice(0, 5000)) await appendEvent(env, { workspaceId: params.workspaceId, projectId: params.projectId, runId: campaignRun.id, type: item.type, source: item.source, serviceId: item.serviceId, journeyId: item.journeyId, payload: item.payload });
  const artifactId = newId("artifact");
  const artifactKey = `${params.workspaceId}/${params.projectId}/${campaignRun.id}/evidence.json`;
  const evidenceHash = await sha256(raw);
  await env.ARTIFACTS.put(artifactKey, raw, { httpMetadata: { contentType: "application/json" }, customMetadata: { sha256: evidenceHash, redacted: "true" } });
  if (evidence.status === "failed" || !evidence.before || !evidence.environmentId) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO evidence_artifacts (id, workspace_id, project_id, run_id, kind, r2_key, sha256, size_bytes, expires_at) VALUES (?, ?, ?, ?, 'runner_failure', ?, ?, ?, datetime('now', '+30 days'))").bind(artifactId, params.workspaceId, params.projectId, campaignRun.id, artifactKey, evidenceHash, raw.length),
      env.DB.prepare("UPDATE campaign_runs SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(campaignRun.id, params.workspaceId),
    ]);
    await appendEvent(env, { workspaceId: params.workspaceId, projectId: params.projectId, runId: campaignRun.id, type: "run.failed", source: "control-plane", evidenceRef: artifactId, payload: { safeMessage: evidence.error || "Runner failed before an observed baseline was available", environmentDestroyedAt: evidence.environmentDestroyedAt } });
    return;
  }
  await env.DB.batch([
    env.DB.prepare("INSERT INTO evidence_artifacts (id, workspace_id, project_id, run_id, kind, r2_key, sha256, size_bytes, expires_at) VALUES (?, ?, ?, ?, 'runner_evidence', ?, ?, ?, datetime('now', '+30 days'))").bind(artifactId, params.workspaceId, params.projectId, campaignRun.id, artifactKey, evidenceHash, raw.length),
    env.DB.prepare("INSERT INTO simulation_runs (id, project_id, scenario, status, before_score, after_score, error_rate, latency_ms, journey_success, duration_seconds, scenario_key, scenario_fingerprint, seed, before_error_rate, after_error_rate, before_latency_ms, after_latency_ms, before_journey_success, after_journey_success, verified_at, evidence_kind, environment_id, journey_runner, environment_destroyed_at, before_service_health, after_service_health, attestation_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'observed', ?, 'playwright', ?, ?, ?, ?, ?)").bind(campaignRun.id, params.projectId, scenario.name, evidence.status, evidence.before.score, evidence.after?.score ?? null, evidence.after?.errorRate || evidence.before.errorRate, evidence.after?.latencyMs || evidence.before.latencyMs, evidence.after?.journeySuccess || evidence.before.journeySuccess, Math.max(1, Math.round((Date.parse(evidence.endedAt) - Date.parse(evidence.startedAt)) / 1000)), scenario.faults?.[0]?.kind || "combined", evidence.scenarioFingerprint, evidence.seed, evidence.before.errorRate, evidence.after?.errorRate || null, evidence.before.latencyMs, evidence.after?.latencyMs || null, evidence.before.journeySuccess, evidence.after?.journeySuccess || null, evidence.status === "completed" ? evidence.endedAt : null, evidence.environmentId, evidence.environmentDestroyedAt, evidence.before.serviceHealth, evidence.after?.serviceHealth || null, JSON.stringify({ startedAt: evidence.startedAt, endedAt: evidence.endedAt, artifactId }), evidence.startedAt),
    env.DB.prepare("UPDATE campaign_runs SET status = ?, simulation_run_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(evidence.status, campaignRun.id, campaignRun.id, params.workspaceId),
  ]);
  await appendEvent(env, { workspaceId: params.workspaceId, projectId: params.projectId, runId: campaignRun.id, type: evidence.status === "completed" ? "run.completed" : "run.failed", source: "control-plane", evidenceRef: artifactId, payload: { evidenceHash, environmentDestroyedAt: evidence.environmentDestroyedAt } });
}

export class WorldModelCampaignWorkflow extends WorkflowEntrypoint<ControlEnv, CampaignParams> {
  async run(event: WorkflowEvent<CampaignParams>, step: WorkflowStep) {
    const params = event.payload;
    const manifest = validateManifest(params.manifest);
    const plan = validateCampaign(params.plan);
    await step.do("mark campaign running", async () => { await this.env.DB.prepare("UPDATE campaigns SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(params.campaignId, params.workspaceId).run(); return null; });
    const rows = await step.do("load approved runs", async () => (await this.env.DB.prepare("SELECT id, scenario_json FROM campaign_runs WHERE campaign_id = ? AND workspace_id = ? ORDER BY scenario_index").bind(params.campaignId, params.workspaceId).all<{ id: string; scenario_json: string }>()).results);
    for (let offset = 0; offset < rows.length; offset += plan.concurrency) {
      const cancellation = await step.do(`check cancellation ${offset}`, async () => this.env.DB.prepare("SELECT cancellation_requested_at FROM campaigns WHERE id = ? AND workspace_id = ?").bind(params.campaignId, params.workspaceId).first<{ cancellation_requested_at?: string }>());
      if (cancellation?.cancellation_requested_at) {
        await step.do("cancel remaining runs", async () => { await this.env.DB.batch([
          this.env.DB.prepare("UPDATE campaign_runs SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE campaign_id = ? AND workspace_id = ? AND status IN ('queued','cancellation_requested')").bind(params.campaignId, params.workspaceId),
          this.env.DB.prepare("UPDATE campaigns SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(params.campaignId, params.workspaceId),
        ]); return null; });
        return { campaignId: params.campaignId, completedRuns: offset, cancelled: true };
      }
      const batch = rows.slice(offset, offset + plan.concurrency);
      await step.do(`execute batch ${Math.floor(offset / plan.concurrency) + 1}`, { retries: { limit: 1, delay: "5 seconds", backoff: "exponential" }, timeout: "20 minutes" }, async () => { await Promise.all(batch.map((row) => executeOne(this.env, params, row, manifest))); return null; });
    }
    await step.do("complete campaign", async () => { await this.env.DB.prepare("UPDATE campaigns SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(params.campaignId, params.workspaceId).run(); return null; });
    return { campaignId: params.campaignId, completedRuns: rows.length };
  }
}

type ScanEvidence = { commitSha: string; clonedAt: string; extractorVersion: string; repositoryType: "node_typescript" | "unsupported" | "configuration_required"; confidence: number; graph: { version: number; nodes: Array<{ id: string; name: string; kind: string; evidence: string[] }>; edges: Array<{ source: string; target: string; kind: string; evidence: string[] }> }; manifestProposal?: unknown; unsupportedReasons?: string[] };

export class WorldModelScanWorkflow extends WorkflowEntrypoint<ControlEnv, ScanParams> {
  async run(event: WorkflowEvent<ScanParams>, step: WorkflowStep) {
    const params = event.payload;
    if (!this.env.SCAN_RUNNER) throw new Error("Exact-commit scan runner is not configured");
    await step.do("mark scan running", async () => { await this.env.DB.prepare("UPDATE repository_scans SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(params.scanId, params.workspaceId).run(); return null; });
    const raw = await step.do("clone exact commit and extract TypeScript model", { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "20 minutes" }, async () => {
      const response = await this.env.SCAN_RUNNER!.fetch(new Request("https://scanner.internal/v1/scans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) }));
      const raw = await response.text();
      if (!response.ok) throw new Error(`Scan runner returned ${response.status}: ${raw.slice(0, 300)}`);
      await verifyEvidence(raw, response.headers.get("x-worldmodel-signature"), this.env.RUNNER_EVIDENCE_SECRET);
      const parsed = JSON.parse(raw) as ScanEvidence;
      if (!/^[a-f0-9]{40}$/i.test(parsed.commitSha) || !parsed.clonedAt || !parsed.extractorVersion || !parsed.graph || !Array.isArray(parsed.graph.nodes) || !Array.isArray(parsed.graph.edges)) throw new Error("Scan runner returned an invalid exact-commit evidence envelope");
      if (parsed.repositoryType === "node_typescript" && parsed.graph.nodes.some((node) => !node.id || !node.kind || !node.evidence?.length)) throw new Error("Every extracted node must include source evidence");
      return raw;
    });
    const parsed = JSON.parse(raw) as ScanEvidence;
    const artifactId = newId("artifact");
    const artifactKey = `${params.workspaceId}/${params.projectId}/${params.scanId}/scan.json`;
    const hash = await sha256(raw);
    await step.do("persist versioned model", async () => {
      await this.env.ARTIFACTS.put(artifactKey, raw, { httpMetadata: { contentType: "application/json" }, customMetadata: { sha256: hash, redacted: "true" } });
      const previous = await this.env.DB.prepare("SELECT user_overrides_json FROM model_versions WHERE workspace_id = ? AND project_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 1").bind(params.workspaceId, params.projectId).first<{ user_overrides_json?: string }>();
      const status = parsed.repositoryType === "node_typescript" ? "draft" : parsed.repositoryType;
      await this.env.DB.batch([
        this.env.DB.prepare("INSERT INTO model_versions (id, workspace_id, project_id, commit_sha, status, graph_json, confidence, scan_version, user_overrides_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(newId("model"), params.workspaceId, params.projectId, parsed.commitSha, status, JSON.stringify(parsed.graph), Math.max(0, Math.min(100, parsed.confidence)), parsed.extractorVersion, previous?.user_overrides_json || "{}"),
        this.env.DB.prepare("INSERT INTO evidence_artifacts (id, workspace_id, project_id, kind, r2_key, sha256, size_bytes, expires_at) VALUES (?, ?, ?, 'repository_scan', ?, ?, ?, datetime('now', '+30 days'))").bind(artifactId, params.workspaceId, params.projectId, artifactKey, hash, raw.length),
        this.env.DB.prepare("UPDATE repository_scans SET status = ?, commit_sha = ?, result_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(status === "draft" ? "completed" : status, parsed.commitSha, JSON.stringify({ artifactId, repositoryType: parsed.repositoryType, unsupportedReasons: parsed.unsupportedReasons || [], manifestProposal: parsed.manifestProposal || null }), params.scanId, params.workspaceId),
        this.env.DB.prepare("UPDATE projects SET status = ?, graph_json = ?, scan_summary = ?, scanned_at = CURRENT_TIMESTAMP, service_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(status === "draft" ? "model_review" : status, JSON.stringify(parsed.graph), parsed.repositoryType === "node_typescript" ? `Exact commit ${parsed.commitSha.slice(0, 12)} extracted by ${parsed.extractorVersion}` : (parsed.unsupportedReasons || []).join("; "), parsed.graph.nodes.length, params.projectId, params.workspaceId),
      ]);
      return null;
    });
    return { scanId: params.scanId, commitSha: parsed.commitSha, repositoryType: parsed.repositoryType, artifactId };
  }
}

type CandidateEvidence = {
  strategy: "minimal" | "resilience" | "architecture";
  rootCause: string;
  propagationPath: string[];
  patch: string;
  files: Array<{ path: string; content: string }>;
  changedFiles: string[];
  tests: string[];
  challengerTest: string;
  scenarioFingerprint: string;
  seed: string;
  commitSha: string;
  environmentDestroyedAt: string;
  gates: { requiredTests: boolean; scenarioCompleted: boolean; dataIntegrity: boolean; secretScan: boolean; prohibitedFiles: boolean; cleanup: boolean };
  metrics: { resilienceImprovement: number; regressionSafety: number; complexity: number; performance: number; security: number; evidenceConfidence: number };
  residualRisks: string[];
};

async function executeCandidate(env: ControlEnv, params: RepairParams, basis: Record<string, unknown>, strategy: CandidateEvidence["strategy"]) {
  if (!env.REPAIR_RUNNER) throw new Error("Repair runner binding is not configured");
  const response = await env.REPAIR_RUNNER.fetch(new Request("https://repair.internal/v1/candidates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...params, strategy, basis, budgets: strategy === "minimal" ? { files: 4, minutes: 20, commands: 12 } : strategy === "resilience" ? { files: 8, minutes: 30, commands: 18 } : { files: 12, minutes: 40, commands: 24 } }) }));
  const raw = await response.text();
  if (!response.ok) throw new Error(`Repair runner returned ${response.status}: ${raw.slice(0, 300)}`);
  await verifyEvidence(raw, response.headers.get("x-worldmodel-signature"), env.RUNNER_EVIDENCE_SECRET);
  const evidence = JSON.parse(raw) as CandidateEvidence;
  if (evidence.strategy !== strategy || !evidence.challengerTest || !evidence.environmentDestroyedAt || !Array.isArray(evidence.files) || evidence.files.length > 30 || evidence.files.some((file) => !/^[A-Za-z0-9_.\/-]{1,240}$/.test(file.path) || file.path.split("/").includes("..") || file.path.startsWith(".github/workflows/") || file.content.length > 1_000_000) || evidence.scenarioFingerprint !== basis.scenario_fingerprint || evidence.seed !== basis.seed || evidence.commitSha !== basis.commit_sha) throw new Error("Candidate evidence does not match the identical replay basis or bounded file contract");
  const hardGatesPassed = Object.values(evidence.gates).every(Boolean);
  const score = candidateScore({ ...evidence.metrics, hardGatesPassed });
  const candidateId = newId("candidate");
  const artifactId = newId("artifact");
  const artifactKey = `${params.workspaceId}/${params.projectId}/${params.investigationId}/${strategy}.json`;
  const hash = await sha256(raw);
  await env.ARTIFACTS.put(artifactKey, raw, { httpMetadata: { contentType: "application/json" }, customMetadata: { sha256: hash, redacted: "true" } });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO evidence_artifacts (id, workspace_id, project_id, run_id, kind, r2_key, sha256, size_bytes, expires_at) VALUES (?, ?, ?, ?, 'repair_candidate', ?, ?, ?, datetime('now', '+30 days'))").bind(artifactId, params.workspaceId, params.projectId, params.runId, artifactKey, hash, raw.length),
    env.DB.prepare("INSERT INTO patch_candidates (id, investigation_id, workspace_id, strategy, status, patch_ref, changed_files_json, tests_json, gates_json, metrics_json, score, risks_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(candidateId, params.investigationId, params.workspaceId, strategy, hardGatesPassed ? "verified" : "rejected", artifactId, JSON.stringify(evidence.changedFiles), JSON.stringify([...evidence.tests, evidence.challengerTest]), JSON.stringify(evidence.gates), JSON.stringify(evidence.metrics), score, JSON.stringify(evidence.residualRisks)),
    env.DB.prepare("INSERT INTO verification_runs (id, candidate_id, workspace_id, scenario_fingerprint, seed, status, metrics_json, gates_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(newId("verify"), candidateId, params.workspaceId, evidence.scenarioFingerprint, evidence.seed, hardGatesPassed ? "passed" : "failed", JSON.stringify(evidence.metrics), JSON.stringify(evidence.gates)),
  ]);
  return { candidateId, strategy, score, hardGatesPassed, artifactId, rootCause: evidence.rootCause, propagationPath: evidence.propagationPath, residualRisks: evidence.residualRisks };
}

export class WorldModelRepairWorkflow extends WorkflowEntrypoint<ControlEnv, RepairParams> {
  async run(event: WorkflowEvent<RepairParams>, step: WorkflowStep) {
    const params = event.payload;
    await step.do("mark investigation running", async () => { await this.env.DB.prepare("UPDATE investigations SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(params.investigationId, params.workspaceId).run(); return null; });
    const basisJson = await step.do("load immutable replay basis", async () => {
      const row = await this.env.DB.prepare("SELECT r.id, r.scenario_fingerprint, r.seed, r.environment_id, mv.commit_sha FROM simulation_runs r JOIN environment_revisions er ON er.id = r.environment_id JOIN model_versions mv ON mv.id = er.model_version_id WHERE r.id = ? AND r.project_id = ? AND r.evidence_kind = 'observed'").bind(params.runId, params.projectId).first<Record<string, unknown>>();
      if (!row?.scenario_fingerprint || !row.seed || !row.commit_sha) throw new Error("Observed run has no immutable verification basis");
      return JSON.stringify(row);
    });
    const basis = JSON.parse(basisJson) as Record<string, unknown>;
    await step.do("record investigation hypothesis", async () => {
      await appendEvent(this.env, { workspaceId: params.workspaceId, projectId: params.projectId, runId: params.runId, type: "investigation.started", source: "repair-control", payload: { investigationId: params.investigationId, objective: params.objective } });
    });
    const results = [];
    for (const strategy of ["minimal", "resilience", "architecture"] as const) {
      const candidateJson = await step.do(`verify ${strategy} candidate`, { retries: { limit: 1, delay: "5 seconds", backoff: "exponential" }, timeout: "45 minutes" }, async () => JSON.stringify(await executeCandidate(this.env, params, basis, strategy)));
      results.push(JSON.parse(candidateJson) as Awaited<ReturnType<typeof executeCandidate>>);
    }
    const ranked = results.toSorted((a, b) => b.score - a.score || a.strategy.localeCompare(b.strategy));
    const winner = ranked.find((candidate) => candidate.hardGatesPassed) || null;
    const report = { version: 1, decision: winner ? `Recommend ${winner.strategy}` : "No candidate passed hard gates", objective: params.objective, rootCause: winner?.rootCause || ranked[0]?.rootCause || "Unresolved", propagationPath: winner?.propagationPath || [], scenarioFingerprint: basis.scenario_fingerprint, seed: basis.seed, commitSha: basis.commit_sha, candidates: ranked, residualRisks: winner?.residualRisks || ["No candidate passed deterministic verification"], rollback: "Revert the selected patch and replay the immutable scenario", immutableEvidence: ranked.map((candidate) => candidate.artifactId) };
    await step.do("publish decision report", async () => {
      const reportId = newId("report");
      await this.env.DB.batch([
        this.env.DB.prepare("INSERT INTO decision_reports (id, workspace_id, project_id, run_id, candidate_id, status, report_json) VALUES (?, ?, ?, ?, ?, 'ready', ?)").bind(reportId, params.workspaceId, params.projectId, params.runId, winner?.candidateId || null, JSON.stringify(report)),
        this.env.DB.prepare("UPDATE investigations SET status = 'completed', hypothesis_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(JSON.stringify({ rootCause: report.rootCause, propagationPath: report.propagationPath }), params.investigationId, params.workspaceId),
      ]);
      await appendEvent(this.env, { workspaceId: params.workspaceId, projectId: params.projectId, runId: params.runId, type: "verification.completed", source: "repair-control", payload: { investigationId: params.investigationId, reportId, winner: winner?.strategy || null } });
      return null;
    });
    return report;
  }
}

export class RunEventHub extends DurableObject<ControlEnv> {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/publish" && request.method === "POST") {
      const message = await request.text();
      for (const socket of this.ctx.getWebSockets()) socket.send(message);
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket upgrade required", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ connectedAt: Date.now() });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) { if (message === "ping") socket.send("pong"); }
}
