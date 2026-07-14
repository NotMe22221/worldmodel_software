import { recordAudit } from "./audit";
import { resolveEntitlements, usagePeriod } from "../worldmodel/entitlements.mjs";
import { buildWorkspaceActivation } from "../worldmodel/activation.mjs";

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

type ScenarioKey = "traffic" | "database" | "payments";

function workspaceSuffix(email: string) {
  return [...email.toLowerCase()]
    .reduce(
      (hash, char) =>
        Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0,
      2166136261,
    )
    .toString(36);
}

const scenarioProfiles: Record<ScenarioKey, {
  label: string;
  fingerprint: string;
  before: { score: number; errorRate: string; latencyMs: number; journeySuccess: number };
  after: { score: number; errorRate: string; latencyMs: number; journeySuccess: number };
}> = {
  traffic: { label: "Traffic spike", fingerprint: "scn_traffic_20x_v1", before: { score: 42, errorRate: "18.7%", latencyMs: 2840, journeySuccess: 61 }, after: { score: 91, errorRate: "0.8%", latencyMs: 612, journeySuccess: 99 } },
  database: { label: "Database slowdown", fingerprint: "scn_database_800ms_v1", before: { score: 38, errorRate: "21.4%", latencyMs: 3190, journeySuccess: 54 }, after: { score: 88, errorRate: "1.2%", latencyMs: 734, journeySuccess: 98 } },
  payments: { label: "Payment outage", fingerprint: "scn_payment_503_45s_v1", before: { score: 31, errorRate: "32.1%", latencyMs: 4060, journeySuccess: 22 }, after: { score: 94, errorRate: "0.4%", latencyMs: 488, journeySuccess: 100 } },
};

async function ensureRunEvidenceColumns(db: Awaited<ReturnType<typeof getD1>>) {
  const columns = await db.prepare("PRAGMA table_info(simulation_runs)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["scenario_key", "TEXT"], ["scenario_fingerprint", "TEXT"], ["seed", "TEXT"],
    ["before_error_rate", "TEXT"], ["after_error_rate", "TEXT"],
    ["before_latency_ms", "INTEGER"], ["after_latency_ms", "INTEGER"],
    ["before_journey_success", "INTEGER"], ["after_journey_success", "INTEGER"],
    ["verified_at", "TEXT"],
    ["evidence_kind", "TEXT NOT NULL DEFAULT 'modeled'"],
    ["environment_id", "TEXT"], ["journey_runner", "TEXT"],
    ["environment_destroyed_at", "TEXT"],
    ["before_service_health", "INTEGER"], ["after_service_health", "INTEGER"],
    ["attestation_json", "TEXT"],
  ];
  for (const [name, type] of additions) {
    if (!existing.has(name)) await db.prepare(`ALTER TABLE simulation_runs ADD COLUMN ${name} ${type}`).run();
  }
  await db.prepare("UPDATE simulation_runs SET evidence_kind = 'sample_fixture' WHERE project_id IN (SELECT id FROM projects WHERE source_kind = 'sample')").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS simulation_runs_replay_identity_idx ON simulation_runs(project_id, scenario_fingerprint, seed, evidence_kind)").run();
}

async function ensureProjectProvenanceColumns(db: Awaited<ReturnType<typeof getD1>>) {
  const columns = await db.prepare("PRAGMA table_info(projects)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  if (!existing.has("source_kind")) await db.prepare("ALTER TABLE projects ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'manual'").run();
  if (!existing.has("repository_verified")) await db.prepare("ALTER TABLE projects ADD COLUMN repository_verified INTEGER NOT NULL DEFAULT 0").run();
  await db.prepare("UPDATE projects SET source_kind = 'sample', repository_verified = 0 WHERE repository = 'shopstream/demo-store' AND id LIKE 'proj_checkout_%'").run();
  await db.prepare("UPDATE projects SET source_kind = 'github', repository_verified = 1 WHERE EXISTS (SELECT 1 FROM github_repositories gr WHERE gr.workspace_id = projects.workspace_id AND lower(gr.full_name) = lower(projects.repository) AND gr.selected = 1)").run();
}

async function ensureWorkspaceLifecycleColumns(db: Awaited<ReturnType<typeof getD1>>) {
  const columns = await db.prepare("PRAGMA table_info(workspaces)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  if (!existing.has("trial_ends_at")) await db.prepare("ALTER TABLE workspaces ADD COLUMN trial_ends_at TEXT").run();
  if (!existing.has("usage_period_start")) await db.prepare("ALTER TABLE workspaces ADD COLUMN usage_period_start TEXT").run();
  if (!existing.has("workspace_mode")) await db.prepare("ALTER TABLE workspaces ADD COLUMN workspace_mode TEXT NOT NULL DEFAULT 'customer'").run();
  await db.prepare("UPDATE workspaces SET trial_ends_at = COALESCE(trial_ends_at, datetime(created_at, '+14 days')), usage_period_start = COALESCE(usage_period_start, strftime('%Y-%m-01T00:00:00.000Z', 'now'))").run();
  await db.prepare("UPDATE workspaces SET workspace_mode = 'sample' WHERE id IN (SELECT DISTINCT workspace_id FROM projects WHERE repository = 'shopstream/demo-store' AND id LIKE 'proj_checkout_%')").run();
}

async function ensureRepairProposalColumns(db: Awaited<ReturnType<typeof getD1>>) {
  const columns = await db.prepare("PRAGMA table_info(repair_proposals)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  if (!existing.has("pr_error")) await db.prepare("ALTER TABLE repair_proposals ADD COLUMN pr_error TEXT").run();
  if (!existing.has("published_at")) await db.prepare("ALTER TABLE repair_proposals ADD COLUMN published_at TEXT").run();
}

async function ensureSupportOperationsColumns(db: Awaited<ReturnType<typeof getD1>>) {
  const columns = await db.prepare("PRAGMA table_info(support_cases)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  if (!existing.has("operator_note")) await db.prepare("ALTER TABLE support_cases ADD COLUMN operator_note TEXT").run();
  if (!existing.has("assigned_to")) await db.prepare("ALTER TABLE support_cases ADD COLUMN assigned_to TEXT").run();
  if (!existing.has("resolved_at")) await db.prepare("ALTER TABLE support_cases ADD COLUMN resolved_at TEXT").run();
}

export async function ensureSaasSchema() {
  const db = await getD1();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_email TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'trial', simulation_minutes INTEGER NOT NULL DEFAULT 0, monthly_limit INTEGER NOT NULL DEFAULT 500, workspace_mode TEXT NOT NULL DEFAULT 'customer', trial_ends_at TEXT, usage_period_start TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, repository TEXT NOT NULL, branch TEXT NOT NULL DEFAULT 'main', source_kind TEXT NOT NULL DEFAULT 'manual', repository_verified INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ready', resilience_score INTEGER NOT NULL DEFAULT 0, service_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS simulation_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), scenario TEXT NOT NULL, status TEXT NOT NULL, before_score INTEGER NOT NULL, after_score INTEGER, error_rate TEXT NOT NULL, latency_ms INTEGER NOT NULL, journey_success INTEGER NOT NULL, duration_seconds INTEGER NOT NULL, evidence_kind TEXT NOT NULL DEFAULT 'modeled', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS repair_proposals (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), run_id TEXT NOT NULL REFERENCES simulation_runs(id), status TEXT NOT NULL DEFAULT 'ready_for_review', title TEXT NOT NULL, summary TEXT NOT NULL, files_json TEXT NOT NULL DEFAULT '[]', tests_json TEXT NOT NULL DEFAULT '[]', risks_json TEXT NOT NULL DEFAULT '[]', created_by TEXT NOT NULL, reviewer_email TEXT, decision_note TEXT, requested_at TEXT, approved_by TEXT, approved_at TEXT, pr_status TEXT NOT NULL DEFAULT 'not_requested', branch_name TEXT, pr_url TEXT, pr_number INTEGER, pr_error TEXT, published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS repair_proposals_run_idx ON repair_proposals(run_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS repair_proposals_workspace_idx ON repair_proposals(workspace_id, updated_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS workspace_members (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL REFERENCES workspaces(id), email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects(workspace_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS runs_project_idx ON simulation_runs(project_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_workspace_email_idx ON workspace_members(workspace_id, email)"),
    db.prepare("CREATE TABLE IF NOT EXISTS workspace_invitations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', token_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', invited_by TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, accepted_at TEXT, revoked_at TEXT)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_token_hash_idx ON workspace_invitations(token_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS workspace_invitations_workspace_idx ON workspace_invitations(workspace_id, status, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS invitation_rate_buckets (id TEXT PRIMARY KEY, subject_hash TEXT NOT NULL, bucket_start TEXT NOT NULL, request_count INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS invitation_rate_subject_start_idx ON invitation_rate_buckets(subject_hash, bucket_start)"),
    db.prepare("CREATE TABLE IF NOT EXISTS user_preferences (email TEXT PRIMARY KEY, active_workspace_id TEXT NOT NULL REFERENCES workspaces(id), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS integration_states (token TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), purpose TEXT NOT NULL, installation_id TEXT, created_by TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS github_installations (installation_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), account_login TEXT NOT NULL, account_type TEXT NOT NULL, repository_selection TEXT NOT NULL, permissions_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', connected_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS github_repositories (repository_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL REFERENCES github_installations(installation_id), workspace_id TEXT NOT NULL REFERENCES workspaces(id), full_name TEXT NOT NULL, default_branch TEXT NOT NULL, is_private INTEGER NOT NULL DEFAULT 1, selected INTEGER NOT NULL DEFAULT 0, synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS subscriptions (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), stripe_customer_id TEXT, stripe_subscription_id TEXT, status TEXT NOT NULL DEFAULT 'trialing', plan TEXT NOT NULL DEFAULT 'trial', current_period_end TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS billing_events (event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS github_installations_workspace_idx ON github_installations(workspace_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS github_repositories_workspace_idx ON github_repositories(workspace_id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_email TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, summary TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS support_cases (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), created_by TEXT NOT NULL, subject TEXT NOT NULL, category TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'open', body TEXT NOT NULL, operator_note TEXT, assigned_to TEXT, resolved_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS audit_logs_workspace_created_idx ON audit_logs(workspace_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS support_cases_workspace_created_idx ON support_cases(workspace_id, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS data_deletion_requests (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), requested_by TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'workspace', status TEXT NOT NULL DEFAULT 'pending', reason TEXT, execute_after TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, canceled_at TEXT, completed_at TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS launch_checks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), check_key TEXT NOT NULL, passed INTEGER NOT NULL DEFAULT 0, evidence TEXT, attested_by TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS launch_checks_workspace_key_idx ON launch_checks(workspace_id, check_key)"),
    db.prepare("CREATE INDEX IF NOT EXISTS deletion_requests_workspace_idx ON data_deletion_requests(workspace_id, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL, scopes_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_by TEXT NOT NULL, last_used_at TEXT, expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at TEXT)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys(key_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS api_keys_workspace_idx ON api_keys(workspace_id, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS api_rate_buckets (id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL REFERENCES api_keys(id), bucket_start TEXT NOT NULL, request_count INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS api_rate_buckets_key_start_idx ON api_rate_buckets(api_key_id, bucket_start)"),
  ]);
  await ensureWorkspaceLifecycleColumns(db);
  await ensureProjectProvenanceColumns(db);
  await ensureRunEvidenceColumns(db);
  await ensureRepairProposalColumns(db);
  await ensureSupportOperationsColumns(db);
}

export async function seedWorkspace(email: string) {
  const db = await getD1();
  const existingMembership = await db.prepare("SELECT workspace_id FROM workspace_members WHERE lower(email) = lower(?) LIMIT 1").bind(email).first();
  if (existingMembership) return;
  const suffix = workspaceSuffix(email);
  const workspaceId = `ws_${suffix}`;
  const projectId = `proj_checkout_${suffix}`;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO workspaces (id, name, owner_email, plan, simulation_minutes, monthly_limit, workspace_mode, trial_ends_at, usage_period_start) VALUES (?, ?, ?, ?, ?, ?, 'sample', ?, ?)").bind(workspaceId, "Northstar Engineering", email, "pro_trial", 214, 500, new Date(Date.now() + 14 * 86_400_000).toISOString(), usagePeriod().start),
    db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, email, role) VALUES (?, ?, ?)").bind(workspaceId, email, "owner"),
    db.prepare("INSERT OR IGNORE INTO projects (id, workspace_id, name, repository, branch, source_kind, repository_verified, status, resilience_score, service_count) VALUES (?, ?, ?, ?, ?, 'sample', 0, ?, ?, ?)").bind(projectId, workspaceId, "Checkout resilience", "shopstream/demo-store", "main", "ready", 94, 7),
    db.prepare("INSERT OR IGNORE INTO simulation_runs (id, project_id, scenario, status, before_score, after_score, error_rate, latency_ms, journey_success, duration_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(`run_payment_${suffix}`, projectId, "Payment outage", "verified", 31, 94, "0.4%", 488, 100, 120, "2026-07-13T23:42:00Z"),
    db.prepare("INSERT OR IGNORE INTO simulation_runs (id, project_id, scenario, status, before_score, after_score, error_rate, latency_ms, journey_success, duration_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(`run_database_${suffix}`, projectId, "Database slowdown", "completed", 38, null, "21.4%", 3190, 54, 120, "2026-07-12T18:20:00Z"),
    db.prepare("INSERT OR IGNORE INTO simulation_runs (id, project_id, scenario, status, before_score, after_score, error_rate, latency_ms, journey_success, duration_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(`run_traffic_${suffix}`, projectId, "Traffic spike", "completed", 42, null, "18.7%", 2840, 61, 120, "2026-07-11T16:08:00Z"),
    db.prepare("UPDATE simulation_runs SET scenario_key = COALESCE(scenario_key, 'payments'), scenario_fingerprint = COALESCE(scenario_fingerprint, 'scn_payment_503_45s_v1'), seed = COALESCE(seed, 'wm_seed_checkout_0713'), before_error_rate = COALESCE(before_error_rate, '32.1%'), after_error_rate = COALESCE(after_error_rate, '0.4%'), before_latency_ms = COALESCE(before_latency_ms, 4060), after_latency_ms = COALESCE(after_latency_ms, 488), before_journey_success = COALESCE(before_journey_success, 22), after_journey_success = COALESCE(after_journey_success, 100), verified_at = COALESCE(verified_at, '2026-07-13T23:42:00Z') WHERE id = ?").bind(`run_payment_${suffix}`),
    db.prepare("UPDATE simulation_runs SET scenario_key = COALESCE(scenario_key, 'database'), scenario_fingerprint = COALESCE(scenario_fingerprint, 'scn_database_800ms_v1'), seed = COALESCE(seed, 'wm_seed_database_0712'), before_error_rate = COALESCE(before_error_rate, '21.4%'), before_latency_ms = COALESCE(before_latency_ms, 3190), before_journey_success = COALESCE(before_journey_success, 54) WHERE id = ?").bind(`run_database_${suffix}`),
    db.prepare("UPDATE simulation_runs SET scenario_key = COALESCE(scenario_key, 'traffic'), scenario_fingerprint = COALESCE(scenario_fingerprint, 'scn_traffic_20x_v1'), seed = COALESCE(seed, 'wm_seed_traffic_0711'), before_error_rate = COALESCE(before_error_rate, '18.7%'), before_latency_ms = COALESCE(before_latency_ms, 2840), before_journey_success = COALESCE(before_journey_success, 61) WHERE id = ?").bind(`run_traffic_${suffix}`),
    db.prepare("UPDATE simulation_runs SET evidence_kind = 'sample_fixture' WHERE project_id = ?").bind(projectId),
  ]);
}

export async function getSaasSnapshot(email: string) {
  await ensureSaasSchema();
  await seedWorkspace(email);
  const db = await getD1();
  const workspace = await db.prepare("SELECT w.*, m.role AS membership_role FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id LEFT JOIN user_preferences pref ON lower(pref.email) = lower(m.email) WHERE lower(m.email) = lower(?) ORDER BY CASE WHEN w.id = pref.active_workspace_id THEN 0 ELSE 1 END, CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, w.created_at LIMIT 1").bind(email).first<{ id: string; membership_role: string } & Record<string, unknown>>();
  if (!workspace) throw new Error("Workspace not found");
  const period = usagePeriod();
  if (String(workspace.usage_period_start || "") !== period.start) {
    await db.prepare("UPDATE workspaces SET simulation_minutes = 0, usage_period_start = ? WHERE id = ?").bind(period.start, workspace.id).run();
    workspace.simulation_minutes = 0;
    workspace.usage_period_start = period.start;
  }
  const projects = await db.prepare("SELECT * FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC").bind(workspace.id).all();
  const runs = await db.prepare("SELECT r.*, p.name AS project_name, p.source_kind, p.repository_verified FROM simulation_runs r JOIN projects p ON p.id = r.project_id WHERE p.workspace_id = ? ORDER BY r.created_at DESC LIMIT 20").bind(workspace.id).all();
  await db.prepare("INSERT OR IGNORE INTO repair_proposals (id, workspace_id, run_id, status, title, summary, files_json, tests_json, risks_json, created_by, requested_at) SELECT 'repair_' || substr(r.id, 5), ?, r.id, 'ready_for_review', 'Graceful ' || lower(r.scenario) || ' recovery', 'Codex generated bounded timeout, idempotency, and recovery controls for the verified scenario.', '[\"src/payment.ts\",\"tests/checkout.spec.mjs\"]', '[\"Identical scenario replay\",\"Critical user journey\",\"Duplicate-order regression\"]', '[\"Regional failover remains unverified\",\"Queue saturation beyond the tested load remains unverified\"]', 'codex@system.worldmodel', CURRENT_TIMESTAMP FROM simulation_runs r JOIN projects p ON p.id = r.project_id WHERE p.workspace_id = ? AND r.status = 'verified'").bind(workspace.id, workspace.id).run();
  const repairs = await db.prepare("SELECT rp.*, r.scenario, r.scenario_fingerprint, r.before_score, r.after_score, r.verified_at, r.evidence_kind, r.environment_id, r.journey_runner, r.environment_destroyed_at, r.before_service_health, r.after_service_health, p.name AS project_name, p.repository, p.branch AS project_branch, p.source_kind, p.repository_verified FROM repair_proposals rp JOIN simulation_runs r ON r.id = rp.run_id JOIN projects p ON p.id = r.project_id WHERE rp.workspace_id = ? ORDER BY rp.updated_at DESC").bind(workspace.id).all();
  const members = await db.prepare("SELECT email, role, created_at FROM workspace_members WHERE workspace_id = ? ORDER BY created_at").bind(workspace.id).all();
  const availableWorkspaces = await db.prepare("SELECT w.id, w.name, w.workspace_mode, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE lower(m.email) = lower(?) ORDER BY w.workspace_mode, w.name").bind(email).all();
  const pendingInvitations = (workspace.membership_role === "owner" || workspace.membership_role === "admin") ? await db.prepare("SELECT id, email, role, status, invited_by, expires_at, created_at, accepted_at, revoked_at FROM workspace_invitations WHERE workspace_id = ? AND status = 'pending' AND datetime(expires_at) > CURRENT_TIMESTAMP ORDER BY created_at DESC").bind(workspace.id).all() : { results: [] };
  const githubInstallations = await db.prepare("SELECT installation_id, account_login, account_type, repository_selection, status, created_at AS connected_at FROM github_installations WHERE workspace_id = ? ORDER BY created_at DESC").bind(workspace.id).all();
  const githubRepositories = await db.prepare("SELECT repository_id, installation_id, full_name, default_branch, is_private, selected, synced_at FROM github_repositories WHERE workspace_id = ? ORDER BY selected DESC, full_name LIMIT 100").bind(workspace.id).all();
  const subscription = await db.prepare("SELECT status, plan, current_period_end, updated_at, CASE WHEN stripe_customer_id IS NOT NULL THEN 1 ELSE 0 END AS portal_available FROM subscriptions WHERE workspace_id = ?").bind(workspace.id).first();
  const entitlements = resolveEntitlements({ workspace, subscription });
  if (Number(workspace.monthly_limit) !== entitlements.limits.simulationMinutes || String(workspace.plan) !== entitlements.planKey) {
    await db.prepare("UPDATE workspaces SET plan = ?, monthly_limit = ? WHERE id = ?").bind(entitlements.planKey, entitlements.limits.simulationMinutes, workspace.id).run();
    workspace.plan = entitlements.planKey;
    workspace.monthly_limit = entitlements.limits.simulationMinutes;
  }
  const auditAccess = workspace.membership_role === "owner" || workspace.membership_role === "admin";
  const auditLogs = auditAccess ? await db.prepare("SELECT id, actor_email, action, target_type, target_id, summary, created_at FROM audit_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50").bind(workspace.id).all() : { results: [] };
  const supportCases = auditAccess ? await db.prepare("SELECT id, created_by, subject, category, priority, status, created_at, updated_at FROM support_cases WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50").bind(workspace.id).all() : await db.prepare("SELECT id, created_by, subject, category, priority, status, created_at, updated_at FROM support_cases WHERE workspace_id = ? AND lower(created_by) = lower(?) ORDER BY created_at DESC LIMIT 50").bind(workspace.id, email).all();
  const launchChecks = await db.prepare("SELECT check_key, passed, evidence, updated_at FROM launch_checks WHERE workspace_id = ? ORDER BY check_key").bind(workspace.id).all();
  const deletionRequests = workspace.membership_role === "owner" ? await db.prepare("SELECT id, scope, status, reason, execute_after, created_at, canceled_at, completed_at FROM data_deletion_requests WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 10").bind(workspace.id).all() : { results: [] };
  const apiKeys = auditAccess ? await db.prepare("SELECT id, name, key_prefix, scopes_json, status, created_by, last_used_at, expires_at, created_at, revoked_at FROM api_keys WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 20").bind(workspace.id).all() : { results: [] };
  const apiUsage = auditAccess ? await db.prepare("SELECT COALESCE(SUM(b.request_count), 0) AS requests_today FROM api_rate_buckets b JOIN api_keys k ON k.id = b.api_key_id WHERE k.workspace_id = ? AND b.bucket_start >= date('now')").bind(workspace.id).first() : { requests_today: 0 };
  const projectRows = projects.results as Array<Record<string, unknown>>;
  const runRows = runs.results as Array<Record<string, unknown>>;
  const memberRows = members.results as Array<Record<string, unknown>>;
  const invitationRows = pendingInvitations.results as Array<Record<string, unknown>>;
  const activation = buildWorkspaceActivation({ workspaceMode: String(workspace.workspace_mode), projects: projectRows, runs: runRows, members: memberRows, invitations: invitationRows });
  return { workspace, availableWorkspaces: availableWorkspaces.results, projects: projectRows, runs: runRows, repairs: repairs.results, members: memberRows, pendingInvitations: invitationRows, githubInstallations: githubInstallations.results, githubRepositories: githubRepositories.results, subscription, entitlements, activation, auditAccess, auditLogs: auditLogs.results, supportCases: supportCases.results, launchChecks: launchChecks.results, deletionRequests: deletionRequests.results, apiKeys: apiKeys.results, apiUsage };
}

export function requireRole(snapshot: Awaited<ReturnType<typeof getSaasSnapshot>>, allowed: string[]) {
  const role = String((snapshot.workspace as Record<string, unknown>).membership_role || "viewer");
  if (!allowed.includes(role)) throw new Error("Your workspace role does not allow this action");
}

export function requireWriteEntitlement(entitlements: { canWrite: boolean; message: string }) {
  if (!entitlements.canWrite) throw new Error(entitlements.message);
}

export async function switchWorkspace(email: string, workspaceId: string) {
  await ensureSaasSchema();
  const db = await getD1();
  const membership = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND lower(email) = lower(?)").bind(workspaceId, email).first();
  if (!membership) throw new Error("Workspace membership not found");
  await db.prepare("INSERT INTO user_preferences (email, active_workspace_id) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET active_workspace_id = excluded.active_workspace_id, updated_at = CURRENT_TIMESTAMP").bind(email.toLowerCase(), workspaceId).run();
  return { workspaceId };
}

export async function provisionCustomerWorkspace(email: string) {
  await ensureSaasSchema();
  await seedWorkspace(email);
  const db = await getD1();
  const existing = await db.prepare("SELECT w.id, w.name, w.workspace_mode FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE lower(m.email) = lower(?) AND m.role = 'owner' AND w.workspace_mode = 'customer' ORDER BY w.created_at LIMIT 1").bind(email).first<{ id: string; name: string; workspace_mode: string }>();
  if (existing) {
    await switchWorkspace(email, existing.id);
    return { workspace: existing, created: false };
  }
  const id = `ws_customer_${workspaceSuffix(email)}`;
  const prefix = email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 45) || "Customer";
  const name = `${prefix} Workspace`;
  const insertion = await db.prepare("INSERT OR IGNORE INTO workspaces (id, name, owner_email, plan, simulation_minutes, monthly_limit, workspace_mode, trial_ends_at, usage_period_start) VALUES (?, ?, ?, 'pro_trial', 0, 500, 'customer', ?, ?)").bind(id, name, email.toLowerCase(), new Date(Date.now() + 14 * 86_400_000).toISOString(), usagePeriod().start).run();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, email, role) VALUES (?, ?, 'owner')").bind(id, email.toLowerCase()),
    db.prepare("INSERT INTO user_preferences (email, active_workspace_id) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET active_workspace_id = excluded.active_workspace_id, updated_at = CURRENT_TIMESTAMP").bind(email.toLowerCase(), id),
  ]);
  const created = Boolean(insertion.meta?.changes);
  if (created) await recordAudit({ workspaceId: id, actorEmail: email, action: "workspace.provisioned", targetType: "workspace", targetId: id, summary: "Provisioned a clean customer workspace", metadata: { source: "sample_onboarding" } });
  return { workspace: { id, name, workspace_mode: "customer" }, created };
}

export async function getWorkspaceEntitlements(workspaceId: string) {
  const db = await getD1();
  const workspace = await db.prepare("SELECT * FROM workspaces WHERE id = ?").bind(workspaceId).first<Record<string, unknown>>();
  if (!workspace) throw new Error("Workspace not found");
  const period = usagePeriod();
  if (String(workspace.usage_period_start || "") !== period.start) {
    await db.prepare("UPDATE workspaces SET simulation_minutes = 0, usage_period_start = ? WHERE id = ?").bind(period.start, workspaceId).run();
    workspace.simulation_minutes = 0;
    workspace.usage_period_start = period.start;
  }
  const subscription = await db.prepare("SELECT status, plan, current_period_end, updated_at FROM subscriptions WHERE workspace_id = ?").bind(workspaceId).first();
  const entitlements = resolveEntitlements({ workspace, subscription });
  if (Number(workspace.monthly_limit) !== entitlements.limits.simulationMinutes || String(workspace.plan) !== entitlements.planKey) {
    await db.prepare("UPDATE workspaces SET plan = ?, monthly_limit = ? WHERE id = ?").bind(entitlements.planKey, entitlements.limits.simulationMinutes, workspaceId).run();
  }
  return entitlements;
}

export async function createProject(email: string, input: { name: string; repository: string; branch: string; sourceKind?: "manual" | "github"; repositoryVerified?: boolean }) {
  const snapshot = await getSaasSnapshot(email);
  if (String(snapshot.workspace.workspace_mode) === "sample") throw new Error("Create a clean customer workspace before connecting a real repository");
  requireRole(snapshot, ["owner", "admin", "member"]);
  requireWriteEntitlement(snapshot.entitlements);
  if (snapshot.projects.length >= snapshot.entitlements.limits.projects) throw new Error(`${snapshot.entitlements.planName} plan project limit reached`);
  const id = `proj_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const db = await getD1();
  const sourceKind = input.sourceKind === "github" ? "github" : "manual";
  const repositoryVerified = sourceKind === "github" && input.repositoryVerified === true;
  await db.prepare("INSERT INTO projects (id, workspace_id, name, repository, branch, source_kind, repository_verified, status, resilience_score, service_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, snapshot.workspace.id, input.name, input.repository, input.branch, sourceKind, repositoryVerified ? 1 : 0, "scanning", 0, 0).run();
  await recordAudit({ workspaceId: String(snapshot.workspace.id), actorEmail: email, action: "project.created", targetType: "project", targetId: id, summary: `Connected ${input.repository}`, metadata: { branch: input.branch, sourceKind, repositoryVerified } });
  return db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
}

export async function updateWorkspace(email: string, name: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  const db = await getD1();
  await db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").bind(name, snapshot.workspace.id).run();
  await recordAudit({ workspaceId: String(snapshot.workspace.id), actorEmail: email, action: "workspace.updated", targetType: "workspace", targetId: String(snapshot.workspace.id), summary: "Updated workspace name" });
  return db.prepare("SELECT * FROM workspaces WHERE id = ?").bind(snapshot.workspace.id).first();
}

export async function createSimulationRun(email: string, scenarioKey: ScenarioKey, requestedProjectId?: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin", "member"]);
  requireWriteEntitlement(snapshot.entitlements);
  return createSimulationRunForWorkspace(String(snapshot.workspace.id), email, scenarioKey, requestedProjectId);
}

export async function createSimulationRunForWorkspace(workspaceId: string, actor: string, scenarioKey: ScenarioKey, requestedProjectId?: string) {
  const db = await getD1();
  const entitlements = await getWorkspaceEntitlements(workspaceId);
  requireWriteEntitlement(entitlements);
  const workspace = await db.prepare("SELECT id, simulation_minutes, monthly_limit FROM workspaces WHERE id = ?").bind(workspaceId).first<{ id: string; simulation_minutes: number; monthly_limit: number }>();
  if (!workspace) throw new Error("Workspace not found");
  if (workspace.simulation_minutes + 2 > entitlements.limits.simulationMinutes) throw new Error("Monthly simulation minute limit reached");
  const project = requestedProjectId
    ? await db.prepare("SELECT id FROM projects WHERE id = ? AND workspace_id = ?").bind(requestedProjectId, workspaceId).first<{ id: string }>()
    : await db.prepare("SELECT id FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1").bind(workspaceId).first<{ id: string }>();
  if (!project) throw new Error("Project not found in this workspace");
  const profile = scenarioProfiles[scenarioKey];
  const id = `run_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const seed = `wm_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  await db.batch([
    db.prepare("INSERT INTO simulation_runs (id, project_id, scenario, status, before_score, after_score, error_rate, latency_ms, journey_success, duration_seconds, scenario_key, scenario_fingerprint, seed, before_error_rate, before_latency_ms, before_journey_success, evidence_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'modeled')").bind(id, project.id, profile.label, "completed", profile.before.score, null, profile.before.errorRate, profile.before.latencyMs, profile.before.journeySuccess, 120, scenarioKey, profile.fingerprint, seed, profile.before.errorRate, profile.before.latencyMs, profile.before.journeySuccess),
    db.prepare("UPDATE workspaces SET simulation_minutes = simulation_minutes + 2 WHERE id = ?").bind(workspace.id),
  ]);
  await recordAudit({ workspaceId: workspace.id, actorEmail: actor, action: "simulation.completed", targetType: "simulation_run", targetId: id, summary: `${profile.label} exposed a release risk`, metadata: { scenario: scenarioKey, fingerprint: profile.fingerprint, beforeScore: profile.before.score } });
  return db.prepare("SELECT * FROM simulation_runs WHERE id = ?").bind(id).first();
}

type ObservedMetricSet = { resilienceScore: number; errorRate: number; latencyMs: number; journeySuccess: number; serviceHealth: number };
type ObservedRunInput = {
  projectId: string;
  scenario: ScenarioKey;
  fingerprint: string;
  seed: string;
  environmentId: string;
  environmentDestroyedAt: string;
  journeyRunner: "playwright";
  journeyName: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  before: ObservedMetricSet;
  after: ObservedMetricSet;
};

export async function ingestObservedRunForWorkspace(workspaceId: string, actor: string, input: ObservedRunInput) {
  const db = await getD1();
  const entitlements = await getWorkspaceEntitlements(workspaceId);
  requireWriteEntitlement(entitlements);
  const project = await db.prepare("SELECT id FROM projects WHERE id = ? AND workspace_id = ?").bind(input.projectId, workspaceId).first<{ id: string }>();
  if (!project) throw new Error("Project not found in this workspace");
  const existing = await db.prepare("SELECT * FROM simulation_runs WHERE project_id = ? AND seed = ? AND evidence_kind = 'observed' LIMIT 1").bind(project.id, input.seed).first<Record<string, unknown>>();
  if (existing) {
    if (existing.scenario_fingerprint !== input.fingerprint || existing.environment_id !== input.environmentId)
      throw new Error("seed was already used for a different observed run");
    return existing;
  }
  const minutes = Math.max(1, Math.ceil(input.durationSeconds / 60));
  const workspace = await db.prepare("SELECT simulation_minutes FROM workspaces WHERE id = ?").bind(workspaceId).first<{ simulation_minutes: number }>();
  if (!workspace) throw new Error("Workspace not found");
  if (Number(workspace.simulation_minutes) + minutes > entitlements.limits.simulationMinutes) throw new Error("Monthly simulation minute limit reached");
  const id = `run_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const profile = scenarioProfiles[input.scenario];
  const beforeErrorRate = `${input.before.errorRate}%`;
  const afterErrorRate = `${input.after.errorRate}%`;
  const attestation = JSON.stringify({ journeyName: input.journeyName, startedAt: input.startedAt, endedAt: input.endedAt });
  await db.batch([
    db.prepare("INSERT INTO simulation_runs (id, project_id, scenario, status, before_score, after_score, error_rate, latency_ms, journey_success, duration_seconds, scenario_key, scenario_fingerprint, seed, before_error_rate, after_error_rate, before_latency_ms, after_latency_ms, before_journey_success, after_journey_success, verified_at, evidence_kind, environment_id, journey_runner, environment_destroyed_at, before_service_health, after_service_health, attestation_json, created_at) VALUES (?, ?, ?, 'verified', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'observed', ?, ?, ?, ?, ?, ?, ?)").bind(id, project.id, profile.label, input.before.resilienceScore, input.after.resilienceScore, afterErrorRate, input.after.latencyMs, input.after.journeySuccess, input.durationSeconds, input.scenario, input.fingerprint, input.seed, beforeErrorRate, afterErrorRate, input.before.latencyMs, input.after.latencyMs, input.before.journeySuccess, input.after.journeySuccess, input.environmentId, input.journeyRunner, input.environmentDestroyedAt, input.before.serviceHealth, input.after.serviceHealth, attestation, input.startedAt),
    db.prepare("UPDATE workspaces SET simulation_minutes = simulation_minutes + ? WHERE id = ?").bind(minutes, workspaceId),
    db.prepare("UPDATE projects SET resilience_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(input.after.resilienceScore, project.id),
  ]);
  await recordAudit({ workspaceId, actorEmail: actor, action: "simulation.observed", targetType: "simulation_run", targetId: id, summary: `${profile.label} observed in ${input.environmentId}`, metadata: { scenario: input.scenario, fingerprint: input.fingerprint, environmentId: input.environmentId, journeyRunner: input.journeyRunner, environmentDestroyedAt: input.environmentDestroyedAt } });
  return db.prepare("SELECT * FROM simulation_runs WHERE id = ?").bind(id).first();
}

export async function verifySimulationRun(email: string, runId: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin", "member"]);
  requireWriteEntitlement(snapshot.entitlements);
  return verifySimulationRunForWorkspace(String(snapshot.workspace.id), email, runId);
}

export async function verifySimulationRunForWorkspace(workspaceId: string, actor: string, runId: string) {
  requireWriteEntitlement(await getWorkspaceEntitlements(workspaceId));
  const db = await getD1();
  const run = await db.prepare("SELECT r.* FROM simulation_runs r JOIN projects p ON p.id = r.project_id WHERE r.id = ? AND p.workspace_id = ?").bind(runId, workspaceId).first<{ scenario_key: ScenarioKey | null; evidence_kind: string } & Record<string, unknown>>();
  if (!run) throw new Error("Simulation run not found in this workspace");
  if (run.evidence_kind === "observed") return run;
  const key = run.scenario_key;
  if (!key || !scenarioProfiles[key]) throw new Error("This legacy run cannot be replayed");
  const profile = scenarioProfiles[key];
  await db.prepare("UPDATE simulation_runs SET status = 'verified', after_score = ?, error_rate = ?, latency_ms = ?, journey_success = ?, after_error_rate = ?, after_latency_ms = ?, after_journey_success = ?, verified_at = CURRENT_TIMESTAMP WHERE id = ?").bind(profile.after.score, profile.after.errorRate, profile.after.latencyMs, profile.after.journeySuccess, profile.after.errorRate, profile.after.latencyMs, profile.after.journeySuccess, runId).run();
  await db.prepare("UPDATE projects SET resilience_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = (SELECT project_id FROM simulation_runs WHERE id = ?)").bind(profile.after.score, runId).run();
  await recordAudit({ workspaceId, actorEmail: actor, action: "simulation.verified", targetType: "simulation_run", targetId: runId, summary: `${profile.label} repair passed identical replay`, metadata: { scenario: key, afterScore: profile.after.score } });
  return db.prepare("SELECT * FROM simulation_runs WHERE id = ?").bind(runId).first();
}

export async function getSimulationReport(email: string, runId: string) {
  const snapshot = await getSaasSnapshot(email);
  const workspace = snapshot.workspace as { id: string };
  const db = await getD1();
  const run = await db.prepare("SELECT r.*, p.name AS project_name, p.repository, p.branch, p.source_kind, p.repository_verified, w.workspace_mode FROM simulation_runs r JOIN projects p ON p.id = r.project_id JOIN workspaces w ON w.id = p.workspace_id WHERE r.id = ? AND p.workspace_id = ?").bind(runId, workspace.id).first<Record<string, unknown>>();
  if (!run) throw new Error("Verification report not found");
  if (run.status !== "verified") throw new Error("Verification report is available after an identical replay passes");
  return run;
}
