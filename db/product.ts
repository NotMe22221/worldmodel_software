import { getSaasSnapshot, requireRole, requireWriteEntitlement } from "./saas";
import { recordAudit } from "./audit";
import { campaignExecutionReadiness, dispatchCampaign, dispatchRepair, dispatchScan, requireCampaignExecution } from "@/server/execution";
import { draftCampaignWithOpenAI } from "@/server/openai";
import { publishGithubDraftFiles } from "@/server/github";
import { getRuntimeEnv } from "@/server/runtime-env";
import { getComposioGithubCommit, publishComposioGithubDraftFiles, type RepositorySource } from "@/server/composio";
import { validateCampaign, validateJourney, validateManifest, type CampaignPlan, type JourneyDefinition, type WorldModelManifest } from "@/worldmodel/product-contracts";

async function d1() { const db = (await getRuntimeEnv() as { DB?: D1Database }).DB; if (!db) throw new Error("database_unavailable: D1 binding DB is unavailable"); return db; }
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

export async function ensureProductSchema() {
  const db = await d1();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS model_versions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, commit_sha TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', graph_json TEXT NOT NULL DEFAULT '{\"nodes\":[],\"edges\":[]}', confidence INTEGER NOT NULL DEFAULT 0, scan_version TEXT NOT NULL DEFAULT 'wm-ts-1', user_overrides_json TEXT NOT NULL DEFAULT '{}', approved_by TEXT, approved_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS model_versions_project_idx ON model_versions(workspace_id, project_id, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS repository_scans (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, repository TEXT NOT NULL, branch TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', workflow_id TEXT, commit_sha TEXT, result_json TEXT, error_code TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS environment_revisions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, model_version_id TEXT NOT NULL, backend TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', manifest_json TEXT NOT NULL, validation_json TEXT NOT NULL DEFAULT '{}', approved_by TEXT, approved_at TEXT, snapshot_ref TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS environments_project_idx ON environment_revisions(workspace_id, project_id, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS user_journeys (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', source TEXT NOT NULL DEFAULT 'user', definition_json TEXT NOT NULL, generated_diff TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS journeys_project_idx ON user_journeys(workspace_id, project_id, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS agent_conversations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, title TEXT NOT NULL, openai_response_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS agent_messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, workspace_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, structured_json TEXT, model TEXT, response_id TEXT, usage_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_messages_conversation_idx ON agent_messages(workspace_id, conversation_id, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, agent_kind TEXT NOT NULL, model TEXT NOT NULL, response_id TEXT NOT NULL, prompt_version TEXT NOT NULL, status TEXT NOT NULL, usage_json TEXT NOT NULL DEFAULT '{}', approval_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS agent_tool_calls (id TEXT PRIMARY KEY, agent_run_id TEXT NOT NULL, workspace_id TEXT NOT NULL, provider_call_id TEXT NOT NULL, tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, validation_status TEXT NOT NULL, result_ref TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, conversation_id TEXT, name TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', plan_json TEXT NOT NULL, estimated_minutes INTEGER NOT NULL, concurrency INTEGER NOT NULL, approved_by TEXT, approved_at TEXT, workflow_id TEXT, cancellation_requested_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS campaigns_project_idx ON campaigns(workspace_id, project_id, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS campaign_runs (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, scenario_index INTEGER NOT NULL, scenario_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', simulation_run_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS run_events (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, run_id TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL, source TEXT NOT NULL, service_id TEXT, journey_id TEXT, payload_json TEXT NOT NULL DEFAULT '{}', evidence_ref TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS run_events_sequence_idx ON run_events(run_id, sequence)"),
    db.prepare("CREATE TABLE IF NOT EXISTS evidence_artifacts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, run_id TEXT, kind TEXT NOT NULL, r2_key TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, redacted INTEGER NOT NULL DEFAULT 1, expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS investigations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, run_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', objective TEXT NOT NULL, hypothesis_json TEXT, workflow_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS patch_candidates (id TEXT PRIMARY KEY, investigation_id TEXT NOT NULL, workspace_id TEXT NOT NULL, strategy TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', patch_ref TEXT, changed_files_json TEXT NOT NULL DEFAULT '[]', tests_json TEXT NOT NULL DEFAULT '[]', gates_json TEXT NOT NULL DEFAULT '{}', metrics_json TEXT NOT NULL DEFAULT '{}', score INTEGER, risks_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS verification_runs (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, workspace_id TEXT NOT NULL, scenario_fingerprint TEXT NOT NULL, seed TEXT NOT NULL, status TEXT NOT NULL, metrics_json TEXT NOT NULL DEFAULT '{}', gates_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS decision_reports (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, run_id TEXT NOT NULL, candidate_id TEXT, status TEXT NOT NULL DEFAULT 'draft', report_json TEXT NOT NULL, artifact_ref TEXT, share_token_hash TEXT, visibility TEXT NOT NULL DEFAULT 'private', published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS report_approvals (report_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL, decision_note TEXT NOT NULL, pr_status TEXT NOT NULL DEFAULT 'not_requested', pr_url TEXT, pr_number INTEGER, published_at TEXT)"),
  ]);
}

async function context(email: string, projectId: string, write = false) {
  await ensureProductSchema();
  const snapshot = await getSaasSnapshot(email);
  if (write) { requireRole(snapshot, ["owner", "admin", "member"]); requireWriteEntitlement(snapshot.entitlements); }
  const db = await d1();
  const project = await db.prepare("SELECT * FROM projects WHERE id = ? AND workspace_id = ?").bind(projectId, snapshot.workspace.id).first<Record<string, unknown>>();
  if (!project) throw new Error("project_not_found: Project was not found in this workspace");
  return { db, snapshot, project, workspaceId: String(snapshot.workspace.id) };
}

export async function productSnapshot(email: string, projectId: string) {
  const { db, project, workspaceId } = await context(email, projectId);
  const [scans, models, environments, journeys, conversations, campaigns, campaignRuns, runs, investigations, candidates, reports] = await Promise.all([
    db.prepare("SELECT * FROM repository_scans WHERE workspace_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 20").bind(workspaceId, projectId).all(),
    db.prepare("SELECT * FROM model_versions WHERE workspace_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 20").bind(workspaceId, projectId).all(),
    db.prepare("SELECT * FROM environment_revisions WHERE workspace_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 20").bind(workspaceId, projectId).all(),
    db.prepare("SELECT * FROM user_journeys WHERE workspace_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 50").bind(workspaceId, projectId).all(),
    db.prepare("SELECT * FROM agent_conversations WHERE workspace_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 20").bind(workspaceId, projectId).all(),
    db.prepare("SELECT * FROM campaigns WHERE workspace_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 50").bind(workspaceId, projectId).all(),
    db.prepare("SELECT cr.* FROM campaign_runs cr JOIN campaigns c ON c.id = cr.campaign_id WHERE cr.workspace_id = ? AND cr.project_id = ? ORDER BY cr.created_at DESC LIMIT 200").bind(workspaceId, projectId).all(),
    db.prepare("SELECT * FROM simulation_runs WHERE project_id = ? AND evidence_kind = 'observed' ORDER BY created_at DESC LIMIT 50").bind(projectId).all(),
    db.prepare("SELECT * FROM investigations WHERE workspace_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 20").bind(workspaceId, projectId).all(),
    db.prepare("SELECT pc.* FROM patch_candidates pc JOIN investigations i ON i.id = pc.investigation_id WHERE pc.workspace_id = ? AND i.project_id = ? ORDER BY pc.created_at DESC LIMIT 60").bind(workspaceId, projectId).all(),
    db.prepare("SELECT * FROM decision_reports WHERE workspace_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 20").bind(workspaceId, projectId).all(),
  ]);
  const selectedEnvironment = environments.results[0] as Record<string, unknown> | undefined;
  const execution = await campaignExecutionReadiness(String(selectedEnvironment?.backend || ""));
  return { project, scans: scans.results, models: models.results, environments: environments.results, journeys: journeys.results, conversations: conversations.results, campaigns: campaigns.results, campaignRuns: campaignRuns.results, runs: runs.results, investigations: investigations.results, candidates: candidates.results, reports: reports.results, execution };
}

export async function rescanRepository(email: string, projectId: string) {
  const { db, workspaceId, project } = await context(email, projectId, true);
  const [composio, githubApp] = await Promise.all([
    db.prepare("SELECT c.connected_account_id, c.composio_user_id FROM composio_github_repositories r JOIN composio_connections c ON c.id = r.connection_id AND c.workspace_id = r.workspace_id WHERE r.workspace_id = ? AND lower(r.full_name) = lower(?) AND c.status = 'active' LIMIT 1").bind(workspaceId, String(project.repository)).first<Record<string, unknown>>(),
    db.prepare("SELECT gr.installation_id FROM github_repositories gr JOIN github_installations gi ON gi.installation_id = gr.installation_id WHERE gr.workspace_id = ? AND lower(gr.full_name) = lower(?) AND gi.status = 'active' LIMIT 1").bind(workspaceId, String(project.repository)).first<Record<string, unknown>>(),
  ]);
  if (project.repository_verified !== 1 || (!composio?.connected_account_id && !githubApp?.installation_id)) throw new Error("repository_not_connected: Reconnect this repository through Composio or the fallback GitHub App");
  let repositorySource: RepositorySource;
  let commitSha: string | undefined;
  if (composio?.connected_account_id && composio.composio_user_id) {
    repositorySource = { kind: "composio", connectedAccountId: String(composio.connected_account_id), composioUserId: String(composio.composio_user_id) };
    commitSha = await getComposioGithubCommit(repositorySource.connectedAccountId, repositorySource.composioUserId, String(project.repository), String(project.branch || "main"));
  } else repositorySource = { kind: "github_app", installationId: String(githubApp?.installation_id) };
  const scanId = id("scan");
  await db.prepare("INSERT INTO repository_scans (id, workspace_id, project_id, repository, branch, status, workflow_id, created_by) VALUES (?, ?, ?, ?, ?, 'dispatching', ?, ?)").bind(scanId, workspaceId, projectId, String(project.repository), String(project.branch || "main"), scanId, email).run();
  try {
    const dispatched = await dispatchScan({ scanId, workspaceId, projectId, repository: String(project.repository), branch: String(project.branch || "main"), repositorySource, commitSha });
    await db.prepare("UPDATE repository_scans SET status = 'queued', workflow_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(dispatched.workflowId, scanId, workspaceId).run();
    return { scanId, workflowId: dispatched.workflowId, status: "queued" };
  } catch (error) {
    await db.prepare("UPDATE repository_scans SET status = 'dispatch_failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(scanId, workspaceId).run();
    throw error;
  }
}

export async function createModelVersion(email: string, projectId: string, input: { commitSha: string; graph: unknown; confidence: number }) {
  const { db, workspaceId } = await context(email, projectId, true);
  if (!/^[a-f0-9]{7,64}$/i.test(input.commitSha) || !input.graph || typeof input.graph !== "object") throw new Error("model_invalid: Commit SHA and graph are required");
  const modelId = id("model");
  await db.prepare("INSERT INTO model_versions (id, workspace_id, project_id, commit_sha, graph_json, confidence) VALUES (?, ?, ?, ?, ?, ?)").bind(modelId, workspaceId, projectId, input.commitSha, JSON.stringify(input.graph), Math.max(0, Math.min(100, input.confidence))).run();
  return db.prepare("SELECT * FROM model_versions WHERE id = ?").bind(modelId).first();
}

export async function approveModelVersion(email: string, projectId: string, modelVersionId: string, overrides: unknown = {}) {
  const { db, workspaceId } = await context(email, projectId, true);
  const model = await db.prepare("SELECT id FROM model_versions WHERE id = ? AND workspace_id = ? AND project_id = ?").bind(modelVersionId, workspaceId, projectId).first();
  if (!model) throw new Error("model_not_found: Model version was not found");
  await db.prepare("UPDATE model_versions SET status = 'approved', user_overrides_json = ?, approved_by = ?, approved_at = ? WHERE id = ? AND workspace_id = ?").bind(JSON.stringify(overrides || {}), email, new Date().toISOString(), modelVersionId, workspaceId).run();
  await recordAudit({ workspaceId, actorEmail: email, action: "model.approved", targetType: "model_version", targetId: modelVersionId, summary: "Approved repository model for environment setup" });
  return db.prepare("SELECT * FROM model_versions WHERE id = ?").bind(modelVersionId).first();
}

export async function saveEnvironment(email: string, projectId: string, input: { modelVersionId: string; backend: string; manifest: unknown; approve?: boolean }) {
  const { db, workspaceId } = await context(email, projectId, true);
  const manifest = validateManifest(input.manifest);
  if (!["cloudflare_sandbox", "github_actions"].includes(input.backend)) throw new Error("environment_invalid: Choose a supported execution backend");
  const model = await db.prepare("SELECT id FROM model_versions WHERE id = ? AND workspace_id = ? AND project_id = ?").bind(input.modelVersionId, workspaceId, projectId).first();
  if (!model) throw new Error("model_not_found: Approve a model version first");
  const environmentId = id("env");
  await db.prepare("INSERT INTO environment_revisions (id, workspace_id, project_id, model_version_id, backend, status, manifest_json, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(environmentId, workspaceId, projectId, input.modelVersionId, input.backend, input.approve ? "approved" : "draft", JSON.stringify(manifest), input.approve ? email : null, input.approve ? new Date().toISOString() : null).run();
  await recordAudit({ workspaceId, actorEmail: email, action: input.approve ? "environment.approved" : "environment.drafted", targetType: "environment_revision", targetId: environmentId, summary: `${input.backend} environment manifest ${input.approve ? "approved" : "saved"}` });
  return db.prepare("SELECT * FROM environment_revisions WHERE id = ?").bind(environmentId).first();
}

export async function createJourney(email: string, projectId: string, definition: unknown, source = "user", approve = false) {
  const { db, workspaceId } = await context(email, projectId, true);
  const journey = validateJourney(definition) as JourneyDefinition;
  const journeyId = id("journey");
  await db.prepare("INSERT INTO user_journeys (id, workspace_id, project_id, status, source, definition_json, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(journeyId, workspaceId, projectId, approve ? "approved" : "draft", source, JSON.stringify(journey), approve ? email : null, approve ? new Date().toISOString() : null).run();
  return db.prepare("SELECT * FROM user_journeys WHERE id = ?").bind(journeyId).first();
}

export async function assistantMessage(email: string, projectId: string, input: { conversationId?: string; message: string }) {
  const { db, workspaceId, project } = await context(email, projectId, true);
  if (!input.message.trim() || input.message.length > 8000) throw new Error("message_invalid: A message under 8,000 characters is required");
  let conversationId = input.conversationId;
  if (!conversationId) { conversationId = id("conv"); await db.prepare("INSERT INTO agent_conversations (id, workspace_id, project_id, title, created_by) VALUES (?, ?, ?, ?, ?)").bind(conversationId, workspaceId, projectId, input.message.trim().slice(0, 80), email).run(); }
  const conversation = await db.prepare("SELECT * FROM agent_conversations WHERE id = ? AND workspace_id = ? AND project_id = ?").bind(conversationId, workspaceId, projectId).first<Record<string, unknown>>();
  if (!conversation) throw new Error("conversation_not_found: Conversation was not found");
  await db.prepare("INSERT INTO agent_messages (id, conversation_id, workspace_id, role, content) VALUES (?, ?, ?, 'user', ?)").bind(id("msg"), conversationId, workspaceId, input.message.trim()).run();
  const model = await db.prepare("SELECT * FROM model_versions WHERE workspace_id = ? AND project_id = ? AND status IN ('approved','ready') ORDER BY created_at DESC LIMIT 1").bind(workspaceId, projectId).first<Record<string, unknown>>();
  const environment = await db.prepare("SELECT * FROM environment_revisions WHERE workspace_id = ? AND project_id = ? AND status IN ('approved','ready') ORDER BY created_at DESC LIMIT 1").bind(workspaceId, projectId).first<Record<string, unknown>>();
  if (!model || !environment) throw new Error("project_not_ready: Approve the system model and environment before drafting campaigns");
  const journeys = await db.prepare("SELECT id, definition_json FROM user_journeys WHERE workspace_id = ? AND project_id = ? AND status = 'approved'").bind(workspaceId, projectId).all<Record<string, unknown>>();
  if (!journeys.results.length) throw new Error("project_not_ready: Approve at least one critical journey before drafting campaigns");
  const result = await draftCampaignWithOpenAI({ message: input.message, project, model, environment, journeys: journeys.results, previousResponseId: String(conversation.openai_response_id || "") || null });
  const campaignId = id("campaign");
  const agentRunId = id("agent_run");
  await db.batch([
    db.prepare("INSERT INTO agent_messages (id, conversation_id, workspace_id, role, content, structured_json, model, response_id, usage_json) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?)").bind(id("msg"), conversationId, workspaceId, result.summary, JSON.stringify(result.plan), result.model, result.responseId, JSON.stringify(result.usage)),
    db.prepare("UPDATE agent_conversations SET openai_response_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(result.responseId, conversationId, workspaceId),
    db.prepare("INSERT INTO campaigns (id, workspace_id, project_id, conversation_id, name, objective, plan_json, estimated_minutes, concurrency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(campaignId, workspaceId, projectId, conversationId, result.plan.name, result.plan.objective, JSON.stringify(result.plan), result.plan.estimatedMinutes, result.plan.concurrency),
    db.prepare("INSERT INTO agent_runs (id, conversation_id, workspace_id, project_id, agent_kind, model, response_id, prompt_version, status, usage_json) VALUES (?, ?, ?, ?, 'scenario_copilot', ?, ?, 'campaign-v1', 'validated', ?)").bind(agentRunId, conversationId, workspaceId, projectId, result.model, result.responseId, JSON.stringify(result.usage)),
    db.prepare("INSERT INTO agent_tool_calls (id, agent_run_id, workspace_id, provider_call_id, tool_name, arguments_json, validation_status, result_ref) VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?)").bind(id("tool_call"), agentRunId, workspaceId, result.toolCall.id, result.toolCall.name, result.toolCall.arguments, campaignId),
  ]);
  return { conversationId, campaignId, summary: result.summary, plan: result.plan };
}

export async function approveCampaign(email: string, projectId: string, campaignId: string) {
  const { db, workspaceId } = await context(email, projectId, true);
  const campaign = await db.prepare("SELECT * FROM campaigns WHERE id = ? AND workspace_id = ? AND project_id = ?").bind(campaignId, workspaceId, projectId).first<Record<string, unknown>>();
  if (!campaign || !["draft", "dispatch_failed"].includes(String(campaign.status))) throw new Error("campaign_invalid_state: Only a draft or safely failed campaign can be approved");
  const plan = validateCampaign(JSON.parse(String(campaign.plan_json))) as CampaignPlan;
  const environment = await db.prepare("SELECT * FROM environment_revisions WHERE workspace_id = ? AND project_id = ? AND status IN ('approved','ready') ORDER BY created_at DESC LIMIT 1").bind(workspaceId, projectId).first<Record<string, unknown>>();
  if (!environment) throw new Error("project_not_ready: Approved environment is required");
  const manifest = validateManifest(JSON.parse(String(environment.manifest_json))) as WorldModelManifest;
  if (plan.scenarios.some((scenario) => scenario.environmentRevisionId !== environment.id || scenario.modelVersionId !== environment.model_version_id || scenario.evidenceMode !== "observed")) throw new Error("campaign_invalid: Every scenario must use the approved model, environment, and observed evidence mode");
  const executionBasis = await db.prepare("SELECT p.repository, p.branch, mv.commit_sha FROM projects p JOIN model_versions mv ON mv.id = ? AND mv.workspace_id = p.workspace_id WHERE p.id = ? AND p.workspace_id = ? LIMIT 1").bind(String(environment.model_version_id), projectId, workspaceId).first<Record<string, unknown>>();
  if (!executionBasis?.commit_sha || !/^[a-f0-9]{40}$/i.test(String(executionBasis.commit_sha))) throw new Error("project_not_ready: An exact 40-character commit basis is required");
  const [composio, githubApp] = await Promise.all([
    db.prepare("SELECT c.connected_account_id, c.composio_user_id FROM composio_github_repositories r JOIN composio_connections c ON c.id = r.connection_id AND c.workspace_id = r.workspace_id WHERE r.workspace_id = ? AND lower(r.full_name) = lower(?) AND c.status = 'active' LIMIT 1").bind(workspaceId, String(executionBasis.repository)).first<Record<string, unknown>>(),
    db.prepare("SELECT gr.installation_id FROM github_repositories gr JOIN github_installations gi ON gi.installation_id = gr.installation_id WHERE gr.workspace_id = ? AND lower(gr.full_name) = lower(?) AND gi.status = 'active' LIMIT 1").bind(workspaceId, String(executionBasis.repository)).first<Record<string, unknown>>(),
  ]);
  const repositorySource: RepositorySource = composio?.connected_account_id && composio.composio_user_id
    ? { kind: "composio", connectedAccountId: String(composio.connected_account_id), composioUserId: String(composio.composio_user_id) }
    : { kind: "github_app", installationId: String(githubApp?.installation_id || "") };
  if (repositorySource.kind === "github_app" && !repositorySource.installationId) throw new Error("project_not_ready: An active Composio or GitHub App repository connection is required");
  await requireCampaignExecution(String(environment.backend));
  const statements = [
    db.prepare("DELETE FROM campaign_runs WHERE campaign_id = ? AND workspace_id = ? AND status IN ('cancelled','failed')").bind(campaignId, workspaceId),
    db.prepare("UPDATE campaigns SET status = 'dispatching', approved_by = ?, approved_at = ?, workflow_id = ?, cancellation_requested_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(email, new Date().toISOString(), campaignId, campaignId, workspaceId),
  ];
  plan.scenarios.forEach((scenario, index) => statements.push(db.prepare("INSERT INTO campaign_runs (id, campaign_id, workspace_id, project_id, scenario_index, scenario_json) VALUES (?, ?, ?, ?, ?, ?)").bind(id("crun"), campaignId, workspaceId, projectId, index, JSON.stringify(scenario))));
  await db.batch(statements);
  let dispatched: { workflowId: string };
  try {
    dispatched = await dispatchCampaign({ campaignId, workspaceId, projectId, backend: String(environment.backend), repository: String(executionBasis.repository), branch: String(executionBasis.branch), repositorySource, commitSha: String(executionBasis.commit_sha), manifest, plan });
    await db.prepare("UPDATE campaigns SET status = 'queued', workflow_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(dispatched.workflowId, campaignId, workspaceId).run();
  } catch (error) {
    await db.batch([
      db.prepare("UPDATE campaigns SET status = 'dispatch_failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(campaignId, workspaceId),
      db.prepare("UPDATE campaign_runs SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE campaign_id = ? AND workspace_id = ?").bind(campaignId, workspaceId),
    ]);
    throw error;
  }
  await recordAudit({ workspaceId, actorEmail: email, action: "campaign.approved", targetType: "campaign", targetId: campaignId, summary: `Approved ${plan.scenarios.length}-run campaign`, metadata: { concurrency: plan.concurrency, estimatedMinutes: plan.estimatedMinutes } });
  return { campaignId, status: "queued", workflowId: dispatched.workflowId };
}

export async function cancelCampaign(email: string, projectId: string, campaignId: string) {
  const { db, workspaceId } = await context(email, projectId, true);
  const campaign = await db.prepare("SELECT status FROM campaigns WHERE id = ? AND workspace_id = ? AND project_id = ?").bind(campaignId, workspaceId, projectId).first<Record<string, unknown>>();
  if (!campaign) throw new Error("campaign_not_found: Campaign was not found");
  if (!["dispatching", "queued", "running"].includes(String(campaign.status))) throw new Error("campaign_invalid_state: This campaign is already in a terminal state");
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE campaigns SET status = 'cancellation_requested', cancellation_requested_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(now, campaignId, workspaceId),
    db.prepare("UPDATE campaign_runs SET status = 'cancellation_requested', updated_at = CURRENT_TIMESTAMP WHERE campaign_id = ? AND workspace_id = ? AND status IN ('queued','running')").bind(campaignId, workspaceId),
  ]);
  await recordAudit({ workspaceId, actorEmail: email, action: "campaign.cancellation_requested", targetType: "campaign", targetId: campaignId, summary: "Requested campaign cancellation and runner cleanup" });
  return { campaignId, status: "cancellation_requested" };
}

export async function startInvestigation(email: string, projectId: string, input: { runId: string; objective: string }) {
  const { db, workspaceId } = await context(email, projectId, true);
  if (!input.objective.trim() || input.objective.length > 120) throw new Error("investigation_invalid: Choose a repair objective");
  const run = await db.prepare("SELECT id, status, evidence_kind FROM simulation_runs WHERE id = ? AND project_id = ?").bind(input.runId, projectId).first<Record<string, unknown>>();
  if (!run || run.evidence_kind !== "observed") throw new Error("run_not_found: An observed customer run is required");
  const investigationId = id("investigation");
  await db.prepare("INSERT INTO investigations (id, workspace_id, project_id, run_id, status, objective, workflow_id, created_by) VALUES (?, ?, ?, ?, 'dispatching', ?, ?, ?)").bind(investigationId, workspaceId, projectId, input.runId, input.objective.trim(), investigationId, email).run();
  try {
    const dispatched = await dispatchRepair({ investigationId, workspaceId, projectId, runId: input.runId, objective: input.objective.trim() });
    await db.prepare("UPDATE investigations SET status = 'queued', workflow_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(dispatched.workflowId, investigationId, workspaceId).run();
    await recordAudit({ workspaceId, actorEmail: email, action: "investigation.started", targetType: "investigation", targetId: investigationId, summary: `Started three-candidate repair tournament for ${input.runId}` });
    return { investigationId, workflowId: dispatched.workflowId, status: "queued" };
  } catch (error) {
    await db.prepare("UPDATE investigations SET status = 'dispatch_failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(investigationId, workspaceId).run();
    throw error;
  }
}

export async function runEvents(email: string, projectId: string, runId: string, after = 0) {
  const { db, workspaceId } = await context(email, projectId);
  return (await db.prepare("SELECT sequence, type, source, service_id, journey_id, payload_json, evidence_ref, created_at AS timestamp FROM run_events WHERE workspace_id = ? AND project_id = ? AND run_id = ? AND sequence > ? ORDER BY sequence LIMIT 1000").bind(workspaceId, projectId, runId, after).all()).results;
}

async function tokenHash(token: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

export async function shareDecisionReport(email: string, projectId: string, reportId: string) {
  const { db, workspaceId } = await context(email, projectId, true);
  const report = await db.prepare("SELECT id FROM decision_reports WHERE id = ? AND workspace_id = ? AND project_id = ? AND status IN ('ready','approved')").bind(reportId, workspaceId, projectId).first();
  if (!report) throw new Error("report_not_found: Verification report was not found or is not ready");
  const token = `wmshare_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  await db.prepare("UPDATE decision_reports SET share_token_hash = ?, visibility = 'shared' WHERE id = ? AND workspace_id = ?").bind(await tokenHash(token), reportId, workspaceId).run();
  await recordAudit({ workspaceId, actorEmail: email, action: "report.shared", targetType: "decision_report", targetId: reportId, summary: "Created a private read-only verification report link" });
  return { reportId, token, path: `/reports/shared/${token}` };
}

export async function approveDecisionReport(email: string, projectId: string, reportId: string, decisionNote: string) {
  const { db, workspaceId } = await context(email, projectId, true); requireRole((await getSaasSnapshot(email)), ["owner", "admin"]);
  if (decisionNote.trim().length < 10 || decisionNote.length > 500) throw new Error("report_invalid: A 10-500 character approval note is required");
  const report = await db.prepare("SELECT id FROM decision_reports WHERE id = ? AND workspace_id = ? AND project_id = ? AND status = 'ready'").bind(reportId, workspaceId, projectId).first(); if (!report) throw new Error("report_not_found: A ready verification report is required");
  const now = new Date().toISOString();
  await db.batch([db.prepare("INSERT INTO report_approvals (report_id, workspace_id, approved_by, approved_at, decision_note) VALUES (?, ?, ?, ?, ?) ON CONFLICT(report_id) DO UPDATE SET approved_by=excluded.approved_by, approved_at=excluded.approved_at, decision_note=excluded.decision_note").bind(reportId, workspaceId, email, now, decisionNote.trim()), db.prepare("UPDATE decision_reports SET status = 'approved' WHERE id = ? AND workspace_id = ?").bind(reportId, workspaceId)]);
  await recordAudit({ workspaceId, actorEmail: email, action: "report.approved", targetType: "decision_report", targetId: reportId, summary: "Approved the verified repair decision; no repository write performed" });
  return { reportId, status: "approved", approvedAt: now };
}

export async function publishDecisionDraftPr(email: string, projectId: string, reportId: string) {
  const { db, workspaceId, project } = await context(email, projectId, true); requireRole((await getSaasSnapshot(email)), ["owner", "admin"]);
  const row = await db.prepare("SELECT dr.report_json, dr.candidate_id, ra.pr_status, pc.patch_ref, ea.r2_key FROM decision_reports dr JOIN report_approvals ra ON ra.report_id=dr.id AND ra.workspace_id=dr.workspace_id JOIN patch_candidates pc ON pc.id=dr.candidate_id AND pc.workspace_id=dr.workspace_id JOIN evidence_artifacts ea ON ea.id=pc.patch_ref AND ea.workspace_id=dr.workspace_id WHERE dr.id=? AND dr.workspace_id=? AND dr.project_id=? AND dr.status='approved' LIMIT 1").bind(reportId, workspaceId, projectId).first<Record<string, unknown>>();
  if (!row) throw new Error("report_not_found: Approve a verified report before publishing a draft pull request");
  const [composio, githubApp] = await Promise.all([
    db.prepare("SELECT c.connected_account_id FROM composio_github_repositories r JOIN composio_connections c ON c.id=r.connection_id AND c.workspace_id=r.workspace_id WHERE r.workspace_id=? AND lower(r.full_name)=lower(?) AND c.status='active' LIMIT 1").bind(workspaceId, String(project.repository)).first<Record<string, unknown>>(),
    db.prepare("SELECT gr.installation_id, gi.permissions_json FROM github_repositories gr JOIN github_installations gi ON gi.installation_id=gr.installation_id AND gi.workspace_id=gr.workspace_id WHERE gr.workspace_id=? AND lower(gr.full_name)=lower(?) AND gi.status='active' LIMIT 1").bind(workspaceId, String(project.repository)).first<Record<string, unknown>>(),
  ]);
  if (!composio?.connected_account_id && !githubApp?.installation_id) throw new Error("repository_not_connected: Reconnect this repository through Composio or the fallback GitHub App");
  const bucket = (await getRuntimeEnv() as unknown as { ARTIFACTS?: R2Bucket }).ARTIFACTS; if (!bucket) throw new Error("artifacts_not_configured: R2 artifacts are unavailable");
  const object = await bucket.get(String(row.r2_key)); if (!object) throw new Error("artifact_not_found: Verified candidate artifact expired or is unavailable"); const evidence = JSON.parse(await object.text()) as { files?: Array<{ path: string; content: string }>; commitSha?: string; strategy?: string };
  if (!evidence.files?.length || !evidence.commitSha) throw new Error("candidate_invalid: Candidate does not contain bounded publishable files");
  const [owner, repository] = String(project.repository).split("/"); if (!owner || !repository) throw new Error("repository_invalid: GitHub repository name is invalid"); const branch = `worldmodel/${reportId.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;
  const publishInput = { owner, repository, baseBranch: String(project.branch), baseSha: evidence.commitSha, headBranch: branch, title: `draft: verified ${evidence.strategy || "repair"} candidate`, body: `WorldModel verification report ${reportId}. This is a draft and must not be merged without human review.`, files: evidence.files };
  let published: { number: number; html_url: string; draft: boolean };
  if (composio?.connected_account_id) {
    published = await publishComposioGithubDraftFiles({ connectedAccountId: String(composio.connected_account_id), ...publishInput });
  } else {
    const permissions = JSON.parse(String(githubApp?.permissions_json || "{}"));
    if (permissions.contents !== "write" || permissions.pull_requests !== "write") throw new Error("github_unauthorized: GitHub App Contents and Pull requests write permissions are required");
    published = await publishGithubDraftFiles({ installationId: String(githubApp?.installation_id), ...publishInput });
  }
  if (!published.draft) throw new Error("github_invalid_response: GitHub did not confirm a draft pull request");
  await db.prepare("UPDATE report_approvals SET pr_status='published', pr_url=?, pr_number=?, published_at=? WHERE report_id=? AND workspace_id=?").bind(published.html_url, published.number, new Date().toISOString(), reportId, workspaceId).run();
  await recordAudit({ workspaceId, actorEmail: email, action: "report.draft_pr_published", targetType: "decision_report", targetId: reportId, summary: `Explicitly published draft pull request #${published.number}`, metadata: { url: published.html_url } });
  return { reportId, draft: true, url: published.html_url, number: published.number };
}

export async function sharedDecisionReport(token: string) {
  if (!/^wmshare_[a-f0-9]{64}$/i.test(token)) throw new Error("report_not_found: Shared report was not found"); const db = await d1(); await ensureProductSchema();
  const report = await db.prepare("SELECT id, report_json, created_at FROM decision_reports WHERE share_token_hash=? AND visibility='shared' AND status IN ('ready','approved') LIMIT 1").bind(await tokenHash(token)).first<Record<string, unknown>>(); if (!report) throw new Error("report_not_found: Shared report was not found");
  return { id: report.id, report: JSON.parse(String(report.report_json)), createdAt: report.created_at, readOnly: true };
}
