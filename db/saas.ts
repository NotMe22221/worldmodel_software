import { recordAudit } from "./audit.ts";
import { resolveEntitlements, usagePeriod } from "../worldmodel/entitlements.mjs";
import { buildWorkspaceActivation } from "../worldmodel/activation.mjs";
import { getRuntimeEnv } from "../server/runtime-env.ts";

async function getD1() {
  const env = await getRuntimeEnv();
  if (!env.DB) throw new Error("Durable database is unavailable");
  return env.DB;
}

type ScenarioKey = "traffic" | "database" | "payments";

const MODELED_RUN_MINUTES = 2;

export const resetWorkspaceUsagePeriodSql = "UPDATE workspaces SET simulation_minutes = 0, usage_period_start = ? WHERE id = ? AND (usage_period_start IS NULL OR usage_period_start <> ?)";
export const reserveModeledRunMinutesSql = "UPDATE workspaces SET simulation_minutes = simulation_minutes + ? WHERE id = ? AND usage_period_start = ? AND simulation_minutes + ? <= ?";

type CustomerWorkspace = { id: string; name: string; workspace_mode: string };

function normalizeOwnerEmail(email: string) {
  return email.trim().toLowerCase();
}

function randomWorkspaceId() {
  return `ws_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function ownedCustomerWorkspace(
  db: Awaited<ReturnType<typeof getD1>>,
  email: string,
) {
  return db
    .prepare("SELECT w.id, w.name, w.workspace_mode FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE lower(m.email) = ? AND m.role = 'owner' AND lower(w.owner_email) = ? AND w.workspace_mode = 'customer' ORDER BY w.created_at, w.id LIMIT 1")
    .bind(email, email)
    .first<CustomerWorkspace>();
}

async function createOwnedCustomerWorkspace(
  db: Awaited<ReturnType<typeof getD1>>,
  email: string,
  name: string,
) {
  const trialEndsAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const periodStart = usagePeriod().start;

  // RuntimeDatabase.batch is a write transaction in both the local SQLite and
  // Turso adapters. The owner-email predicates keep a UUID conflict from ever
  // attaching a person to an unrelated workspace, while the NOT EXISTS guard
  // makes concurrent onboarding for the same owner idempotent.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = randomWorkspaceId();
    const results = await db.batch([
      db.prepare("INSERT OR IGNORE INTO workspaces (id, name, owner_email, plan, simulation_minutes, monthly_limit, workspace_mode, trial_ends_at, usage_period_start) SELECT ?, ?, ?, 'pro_trial', 0, 500, 'customer', ?, ? WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE lower(owner_email) = ? AND workspace_mode = 'customer')").bind(id, name, email, trialEndsAt, periodStart, email),
      db.prepare("INSERT INTO workspace_members (workspace_id, email, role) SELECT w.id, ?, 'owner' FROM workspaces w WHERE lower(w.owner_email) = ? AND w.workspace_mode = 'customer' AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND lower(m.email) = ?) ORDER BY w.created_at, w.id LIMIT 1").bind(email, email, email),
      db.prepare("INSERT INTO user_preferences (email, active_workspace_id) SELECT ?, w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE lower(w.owner_email) = ? AND w.workspace_mode = 'customer' AND lower(m.email) = ? AND m.role = 'owner' ORDER BY w.created_at, w.id LIMIT 1 ON CONFLICT(email) DO UPDATE SET active_workspace_id = excluded.active_workspace_id, updated_at = CURRENT_TIMESTAMP").bind(email, email, email),
    ]);
    const workspace = await ownedCustomerWorkspace(db, email);
    if (workspace) {
      const insertion = results[0] as { meta?: { changes?: number } } | undefined;
      return { workspace, created: Boolean(insertion?.meta?.changes) };
    }
  }

  throw new Error("Unable to provision an isolated customer workspace");
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
  if (!existing.has("graph_json")) await db.prepare("ALTER TABLE projects ADD COLUMN graph_json TEXT NOT NULL DEFAULT '{\"version\":1,\"nodes\":[],\"edges\":[]}'").run();
  if (!existing.has("scan_summary")) await db.prepare("ALTER TABLE projects ADD COLUMN scan_summary TEXT").run();
  if (!existing.has("scanned_at")) await db.prepare("ALTER TABLE projects ADD COLUMN scanned_at TEXT").run();
  await db.prepare("UPDATE projects SET source_kind = 'sample', repository_verified = 0 WHERE repository = 'shopstream/demo-store' AND id LIKE 'proj_checkout_%'").run();
  await db.prepare("UPDATE projects SET source_kind = 'github', repository_verified = 1 WHERE EXISTS (SELECT 1 FROM github_workspace_repositories gr WHERE gr.workspace_id = projects.workspace_id AND lower(gr.full_name) = lower(projects.repository) AND gr.selected = 1)").run();
  await db.prepare("UPDATE projects SET status = 'unverified' WHERE source_kind = 'manual' AND scanned_at IS NULL").run();
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

async function ensureSubscriptionEventColumns(db: Awaited<ReturnType<typeof getD1>>) {
  const columns = await db.prepare("PRAGMA table_info(subscriptions)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["stripe_event_created", "INTEGER NOT NULL DEFAULT 0"],
    ["stripe_event_priority", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [name, type] of additions) {
    if (existing.has(name)) continue;
    try {
      await db.prepare(`ALTER TABLE subscriptions ADD COLUMN ${name} ${type}`).run();
    } catch (error) {
      if (!/duplicate column name/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
}

export async function ensureSaasSchema() {
  const db = await getD1();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_email TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'trial', simulation_minutes INTEGER NOT NULL DEFAULT 0, monthly_limit INTEGER NOT NULL DEFAULT 500, workspace_mode TEXT NOT NULL DEFAULT 'customer', trial_ends_at TEXT, usage_period_start TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, repository TEXT NOT NULL, branch TEXT NOT NULL DEFAULT 'main', source_kind TEXT NOT NULL DEFAULT 'manual', repository_verified INTEGER NOT NULL DEFAULT 0, graph_json TEXT NOT NULL DEFAULT '{\"version\":1,\"nodes\":[],\"edges\":[]}', scan_summary TEXT, scanned_at TEXT, status TEXT NOT NULL DEFAULT 'ready', resilience_score INTEGER NOT NULL DEFAULT 0, service_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
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
    db.prepare("CREATE TABLE IF NOT EXISTS github_workspace_installations (workspace_id TEXT NOT NULL REFERENCES workspaces(id), installation_id TEXT NOT NULL, account_login TEXT NOT NULL, account_type TEXT NOT NULL, repository_selection TEXT NOT NULL, permissions_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', connected_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (workspace_id, installation_id))"),
    db.prepare("CREATE INDEX IF NOT EXISTS github_workspace_installations_workspace_idx ON github_workspace_installations(workspace_id, status)"),
    db.prepare("CREATE TABLE IF NOT EXISTS github_workspace_repositories (workspace_id TEXT NOT NULL REFERENCES workspaces(id), repository_id TEXT NOT NULL, installation_id TEXT NOT NULL, full_name TEXT NOT NULL, default_branch TEXT NOT NULL, is_private INTEGER NOT NULL DEFAULT 1, selected INTEGER NOT NULL DEFAULT 0, synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (workspace_id, repository_id), FOREIGN KEY (workspace_id, installation_id) REFERENCES github_workspace_installations(workspace_id, installation_id))"),
    db.prepare("CREATE INDEX IF NOT EXISTS github_workspace_repositories_workspace_idx ON github_workspace_repositories(workspace_id, selected, full_name)"),
    db.prepare("CREATE TABLE IF NOT EXISTS composio_connection_attempts (state_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), created_by TEXT NOT NULL, composio_user_id TEXT NOT NULL, connected_account_id TEXT, auth_config_id TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS composio_attempts_workspace_idx ON composio_connection_attempts(workspace_id, expires_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS composio_connections (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), connected_account_id TEXT NOT NULL, composio_user_id TEXT NOT NULL, auth_config_id TEXT NOT NULL, toolkit_slug TEXT NOT NULL DEFAULT 'github', provider_login TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', connected_by TEXT NOT NULL, last_synced_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS composio_connections_workspace_account_idx ON composio_connections(workspace_id, connected_account_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS composio_connections_workspace_idx ON composio_connections(workspace_id, status)"),
    db.prepare("CREATE TABLE IF NOT EXISTS composio_github_repositories (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES composio_connections(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id), repository_id TEXT NOT NULL, full_name TEXT NOT NULL, default_branch TEXT NOT NULL, is_private INTEGER NOT NULL DEFAULT 1, html_url TEXT NOT NULL, selected INTEGER NOT NULL DEFAULT 0, synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS composio_repositories_connection_repo_idx ON composio_github_repositories(connection_id, repository_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS composio_repositories_workspace_idx ON composio_github_repositories(workspace_id, selected, full_name)"),
    db.prepare("CREATE TABLE IF NOT EXISTS subscriptions (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), stripe_customer_id TEXT, stripe_subscription_id TEXT, status TEXT NOT NULL DEFAULT 'trialing', plan TEXT NOT NULL DEFAULT 'trial', current_period_end TEXT, stripe_event_created INTEGER NOT NULL DEFAULT 0, stripe_event_priority INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
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
  // Preserve deployed data without rebuilding or dropping the legacy tables.
  // INSERT OR IGNORE makes this safe on every request and ensures the first
  // tenant-scoped copy cannot later be reassigned by a legacy global UPSERT.
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO github_workspace_installations (workspace_id, installation_id, account_login, account_type, repository_selection, permissions_json, status, connected_by, created_at, updated_at) SELECT workspace_id, installation_id, account_login, account_type, repository_selection, permissions_json, status, connected_by, created_at, updated_at FROM github_installations"),
    db.prepare("INSERT OR IGNORE INTO github_workspace_repositories (workspace_id, repository_id, installation_id, full_name, default_branch, is_private, selected, synced_at) SELECT gr.workspace_id, gr.repository_id, gr.installation_id, gr.full_name, gr.default_branch, gr.is_private, gr.selected, gr.synced_at FROM github_repositories gr JOIN github_workspace_installations gi ON gi.workspace_id = gr.workspace_id AND gi.installation_id = gr.installation_id"),
  ]);
  await ensureWorkspaceLifecycleColumns(db);
  await ensureProjectProvenanceColumns(db);
  await ensureRunEvidenceColumns(db);
  await ensureRepairProposalColumns(db);
  await ensureSupportOperationsColumns(db);
  await ensureSubscriptionEventColumns(db);
}

export async function seedWorkspace(email: string, preferredName?: string) {
  const db = await getD1();
  const normalizedEmail = normalizeOwnerEmail(email);
  const existingMembership = await db.prepare("SELECT m.workspace_id FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE lower(m.email)=? AND w.workspace_mode='customer' LIMIT 1").bind(normalizedEmail).first();
  if (existingMembership) return;
  const ownerName = normalizedEmail.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 60) || "Engineering";
  const workspaceName = preferredName?.trim().slice(0, 80) || `${ownerName} Workspace`;
  await createOwnedCustomerWorkspace(db, normalizedEmail, workspaceName);
}

export async function getSaasSnapshot(email: string) {
  await ensureSaasSchema();
  await seedWorkspace(email);
  const db = await getD1();
  const workspace = await db.prepare("SELECT w.*, m.role AS membership_role FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id LEFT JOIN user_preferences pref ON lower(pref.email) = lower(m.email) WHERE lower(m.email) = lower(?) AND w.workspace_mode='customer' ORDER BY CASE WHEN w.id = pref.active_workspace_id THEN 0 ELSE 1 END, CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, w.created_at LIMIT 1").bind(email).first<{ id: string; membership_role: string } & Record<string, unknown>>();
  if (!workspace) throw new Error("Workspace not found");
  const period = usagePeriod();
  if (String(workspace.usage_period_start || "") !== period.start) {
    const reset = await db.prepare(resetWorkspaceUsagePeriodSql).bind(period.start, workspace.id, period.start).run();
    if (Number(reset.meta.changes || 0) === 1) {
      workspace.simulation_minutes = 0;
      workspace.usage_period_start = period.start;
    } else {
      const currentUsage = await db.prepare("SELECT simulation_minutes, usage_period_start FROM workspaces WHERE id = ?").bind(workspace.id).first<{ simulation_minutes: number; usage_period_start: string | null }>();
      if (!currentUsage) throw new Error("Workspace not found");
      workspace.simulation_minutes = currentUsage.simulation_minutes;
      workspace.usage_period_start = currentUsage.usage_period_start;
    }
  }
  const projects = await db.prepare("SELECT * FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC").bind(workspace.id).all();
  const runs = await db.prepare("SELECT r.*, p.name AS project_name, p.source_kind, p.repository_verified FROM simulation_runs r JOIN projects p ON p.id = r.project_id WHERE p.workspace_id = ? ORDER BY r.created_at DESC LIMIT 20").bind(workspace.id).all();
  const repairs = await db.prepare("SELECT rp.*, r.scenario, r.scenario_fingerprint, r.before_score, r.after_score, r.verified_at, r.evidence_kind, r.environment_id, r.journey_runner, r.environment_destroyed_at, r.before_service_health, r.after_service_health, p.name AS project_name, p.repository, p.branch AS project_branch, p.source_kind, p.repository_verified FROM repair_proposals rp JOIN simulation_runs r ON r.id = rp.run_id JOIN projects p ON p.id = r.project_id WHERE rp.workspace_id = ? AND NOT (rp.created_by = 'codex@system.worldmodel' AND rp.summary = 'Codex generated bounded timeout, idempotency, and recovery controls for the verified scenario.') ORDER BY rp.updated_at DESC").bind(workspace.id).all();
  const members = await db.prepare("SELECT email, role, created_at FROM workspace_members WHERE workspace_id = ? ORDER BY created_at").bind(workspace.id).all();
  const availableWorkspaces = await db.prepare("SELECT w.id, w.name, w.workspace_mode, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE lower(m.email) = lower(?) AND w.workspace_mode='customer' ORDER BY w.name").bind(email).all();
  const pendingInvitations = (workspace.membership_role === "owner" || workspace.membership_role === "admin") ? await db.prepare("SELECT id, email, role, status, invited_by, expires_at, created_at, accepted_at, revoked_at FROM workspace_invitations WHERE workspace_id = ? AND status = 'pending' AND datetime(expires_at) > CURRENT_TIMESTAMP ORDER BY created_at DESC").bind(workspace.id).all() : { results: [] as Record<string, unknown>[] };
  const githubInstallations = await db.prepare("SELECT installation_id, account_login, account_type, repository_selection, status, created_at AS connected_at FROM github_workspace_installations WHERE workspace_id = ? ORDER BY created_at DESC").bind(workspace.id).all();
  const githubRepositories = await db.prepare("SELECT repository_id, installation_id, full_name, default_branch, is_private, selected, synced_at FROM github_workspace_repositories WHERE workspace_id = ? ORDER BY selected DESC, full_name LIMIT 100").bind(workspace.id).all();
  const composioConnections = await db.prepare("SELECT id, connected_account_id, provider_login, toolkit_slug, status, last_synced_at, created_at AS connected_at FROM composio_connections WHERE workspace_id = ? ORDER BY created_at DESC").bind(workspace.id).all();
  const composioRepositories = await db.prepare("SELECT id, connection_id, repository_id, full_name, default_branch, is_private, html_url, selected, synced_at FROM composio_github_repositories WHERE workspace_id = ? ORDER BY selected DESC, full_name LIMIT 100").bind(workspace.id).all();
  const subscription = await db.prepare("SELECT status, plan, current_period_end, updated_at, CASE WHEN stripe_customer_id IS NOT NULL THEN 1 ELSE 0 END AS portal_available FROM subscriptions WHERE workspace_id = ?").bind(workspace.id).first();
  const entitlements = resolveEntitlements({ workspace, subscription });
  if (Number(workspace.monthly_limit) !== entitlements.limits.simulationMinutes || String(workspace.plan) !== entitlements.planKey) {
    await db.prepare("UPDATE workspaces SET plan = ?, monthly_limit = ? WHERE id = ?").bind(entitlements.planKey, entitlements.limits.simulationMinutes, workspace.id).run();
    workspace.plan = entitlements.planKey;
    workspace.monthly_limit = entitlements.limits.simulationMinutes;
  }
  const auditAccess = workspace.membership_role === "owner" || workspace.membership_role === "admin";
  const auditLogs = auditAccess ? await db.prepare("SELECT id, actor_email, action, target_type, target_id, summary, created_at FROM audit_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50").bind(workspace.id).all() : { results: [] as Record<string, unknown>[] };
  const supportCases = auditAccess ? await db.prepare("SELECT id, created_by, subject, category, priority, status, created_at, updated_at FROM support_cases WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50").bind(workspace.id).all() : await db.prepare("SELECT id, created_by, subject, category, priority, status, created_at, updated_at FROM support_cases WHERE workspace_id = ? AND lower(created_by) = lower(?) ORDER BY created_at DESC LIMIT 50").bind(workspace.id, email).all();
  const launchChecks = await db.prepare("SELECT check_key, passed, evidence, updated_at FROM launch_checks WHERE workspace_id = ? ORDER BY check_key").bind(workspace.id).all<{ check_key: string; passed: number | boolean; evidence?: string | null; updated_at: string }>();
  const deletionRequests = workspace.membership_role === "owner" ? await db.prepare("SELECT id, scope, status, reason, execute_after, created_at, canceled_at, completed_at FROM data_deletion_requests WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 10").bind(workspace.id).all() : { results: [] as Record<string, unknown>[] };
  const apiKeys = auditAccess ? await db.prepare("SELECT id, name, key_prefix, scopes_json, status, created_by, last_used_at, expires_at, created_at, revoked_at FROM api_keys WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 20").bind(workspace.id).all() : { results: [] as Record<string, unknown>[] };
  const apiUsage = auditAccess ? await db.prepare("SELECT COALESCE(SUM(b.request_count), 0) AS requests_today FROM api_rate_buckets b JOIN api_keys k ON k.id = b.api_key_id WHERE k.workspace_id = ? AND b.bucket_start >= date('now')").bind(workspace.id).first() : { requests_today: 0 };
  const projectRows = projects.results as Array<Record<string, unknown>>;
  const runRows = runs.results as Array<Record<string, unknown>>;
  const memberRows = members.results as Array<Record<string, unknown>>;
  const invitationRows = pendingInvitations.results as Array<Record<string, unknown>>;
  const activation = buildWorkspaceActivation({ workspaceMode: String(workspace.workspace_mode), projects: projectRows, runs: runRows, members: memberRows, invitations: invitationRows });
  return { workspace, availableWorkspaces: availableWorkspaces.results, projects: projectRows, runs: runRows, repairs: repairs.results, members: memberRows, pendingInvitations: invitationRows, composioConnections: composioConnections.results, composioRepositories: composioRepositories.results, githubInstallations: githubInstallations.results, githubRepositories: githubRepositories.results, subscription, entitlements, activation, auditAccess, auditLogs: auditLogs.results, supportCases: supportCases.results, launchChecks: launchChecks.results, deletionRequests: deletionRequests.results, apiKeys: apiKeys.results, apiUsage };
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
  const membership = await db.prepare("SELECT m.role FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=? AND lower(m.email)=lower(?) AND w.workspace_mode='customer'").bind(workspaceId, email).first();
  if (!membership) throw new Error("Workspace membership not found");
  await db.prepare("INSERT INTO user_preferences (email, active_workspace_id) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET active_workspace_id = excluded.active_workspace_id, updated_at = CURRENT_TIMESTAMP").bind(email.toLowerCase(), workspaceId).run();
  return { workspaceId };
}

export async function provisionCustomerWorkspace(email: string, preferredName?: string) {
  await ensureSaasSchema();
  const db = await getD1();
  const normalizedEmail = normalizeOwnerEmail(email);
  const existing = await ownedCustomerWorkspace(db, normalizedEmail);
  if (existing) {
    await switchWorkspace(normalizedEmail, existing.id);
    return { workspace: existing, created: false };
  }
  const prefix = normalizedEmail.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 45) || "Customer";
  const name = preferredName?.trim().slice(0, 80) || `${prefix} Workspace`;
  const provisioned = await createOwnedCustomerWorkspace(db, normalizedEmail, name);
  if (provisioned.created) await recordAudit({ workspaceId: provisioned.workspace.id, actorEmail: normalizedEmail, action: "workspace.provisioned", targetType: "workspace", targetId: provisioned.workspace.id, summary: "Provisioned a clean customer workspace", metadata: { source: "account_onboarding" } });
  return provisioned;
}

export async function getWorkspaceEntitlements(workspaceId: string) {
  const db = await getD1();
  const workspace = await db.prepare("SELECT * FROM workspaces WHERE id = ?").bind(workspaceId).first<Record<string, unknown>>();
  if (!workspace) throw new Error("Workspace not found");
  const period = usagePeriod();
  if (String(workspace.usage_period_start || "") !== period.start) {
    const reset = await db.prepare(resetWorkspaceUsagePeriodSql).bind(period.start, workspaceId, period.start).run();
    if (Number(reset.meta.changes || 0) === 1) {
      workspace.simulation_minutes = 0;
      workspace.usage_period_start = period.start;
    } else {
      const currentUsage = await db.prepare("SELECT simulation_minutes, usage_period_start FROM workspaces WHERE id = ?").bind(workspaceId).first<{ simulation_minutes: number; usage_period_start: string | null }>();
      if (!currentUsage) throw new Error("Workspace not found");
      workspace.simulation_minutes = currentUsage.simulation_minutes;
      workspace.usage_period_start = currentUsage.usage_period_start;
    }
  }
  const subscription = await db.prepare("SELECT status, plan, current_period_end, updated_at FROM subscriptions WHERE workspace_id = ?").bind(workspaceId).first();
  const entitlements = resolveEntitlements({ workspace, subscription });
  if (Number(workspace.monthly_limit) !== entitlements.limits.simulationMinutes || String(workspace.plan) !== entitlements.planKey) {
    await db.prepare("UPDATE workspaces SET plan = ?, monthly_limit = ? WHERE id = ?").bind(entitlements.planKey, entitlements.limits.simulationMinutes, workspaceId).run();
  }
  return entitlements;
}

type CreateProjectInput = { name: string; repository: string; branch: string; sourceKind?: "manual" | "github"; repositoryVerified?: boolean };

export async function createProjectForWorkspace(workspaceId: string, actorEmail: string, input: CreateProjectInput) {
  await ensureSaasSchema();
  const db = await getD1();
  const actor = normalizeOwnerEmail(actorEmail);
  const membership = await db.prepare("SELECT w.workspace_mode, m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id AND lower(m.email) = ? WHERE w.id = ? LIMIT 1").bind(actor, workspaceId).first<{ workspace_mode: string; role: string }>();
  if (!membership || !["owner", "admin", "member"].includes(membership.role)) throw new Error("Workspace role does not allow this action");
  if (membership.workspace_mode === "sample") throw new Error("Create a clean customer workspace before connecting a real repository");
  const entitlements = await getWorkspaceEntitlements(workspaceId);
  requireWriteEntitlement(entitlements);
  const name = input.name.trim();
  const repository = input.repository.trim();
  const branch = input.branch.trim();
  if (!name || name.length > 80 || !repository || repository.length > 160 || !/^[A-Za-z0-9._/-]{1,120}$/.test(branch) || branch.startsWith("/") || branch.endsWith("/") || branch.split("/").includes("..")) throw new Error("Project name, repository, or branch is invalid");
  if (input.sourceKind === "github" && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Verified GitHub repository name is invalid");
  const id = `proj_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const sourceKind = input.sourceKind === "github" ? "github" : "manual";
  const repositoryVerified = sourceKind === "github" && input.repositoryVerified === true;
  const insertSql = sourceKind === "github"
    ? "INSERT INTO projects (id, workspace_id, name, repository, branch, source_kind, repository_verified, status, resilience_score, service_count) SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, 0 WHERE (SELECT COUNT(*) FROM projects WHERE workspace_id = ?) < ? AND NOT EXISTS (SELECT 1 FROM projects WHERE workspace_id = ? AND lower(repository) = lower(?))"
    : "INSERT INTO projects (id, workspace_id, name, repository, branch, source_kind, repository_verified, status, resilience_score, service_count) SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, 0 WHERE (SELECT COUNT(*) FROM projects WHERE workspace_id = ?) < ?";
  const prepared = db.prepare(insertSql);
  const inserted = sourceKind === "github"
    ? await prepared.bind(id, workspaceId, name, repository, branch, sourceKind, repositoryVerified ? 1 : 0, "scanning", workspaceId, entitlements.limits.projects, workspaceId, repository).run()
    : await prepared.bind(id, workspaceId, name, repository, branch, sourceKind, 0, "unverified", workspaceId, entitlements.limits.projects).run();
  if (Number(inserted.meta.changes || 0) !== 1) {
    if (sourceKind === "github") {
      const existing = await db.prepare("SELECT * FROM projects WHERE workspace_id = ? AND lower(repository) = lower(?) LIMIT 1").bind(workspaceId, repository).first();
      if (existing) return existing;
    }
    throw new Error(`${entitlements.planName} plan project limit reached`);
  }
  await recordAudit({ workspaceId, actorEmail: actor, action: "project.created", targetType: "project", targetId: id, summary: `Connected ${repository}`, metadata: { branch, sourceKind, repositoryVerified } });
  return db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
}

export async function createProject(email: string, input: CreateProjectInput) {
  const snapshot = await getSaasSnapshot(email);
  return createProjectForWorkspace(String(snapshot.workspace.id), email, input);
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
  const project = requestedProjectId
    ? await db.prepare("SELECT id FROM projects WHERE id = ? AND workspace_id = ?").bind(requestedProjectId, workspaceId).first<{ id: string }>()
    : await db.prepare("SELECT id FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1").bind(workspaceId).first<{ id: string }>();
  if (!project) throw new Error("Project not found in this workspace");
  const profile = scenarioProfiles[scenarioKey];
  const id = `run_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const seed = `wm_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  const reserved = await db.prepare(reserveModeledRunMinutesSql).bind(MODELED_RUN_MINUTES, workspaceId, entitlements.usagePeriodStart, MODELED_RUN_MINUTES, entitlements.limits.simulationMinutes).run();
  if (Number(reserved.meta.changes || 0) !== 1) throw new Error("Monthly simulation minute limit reached");
  try {
    await db.prepare("INSERT INTO simulation_runs (id, project_id, scenario, status, before_score, after_score, error_rate, latency_ms, journey_success, duration_seconds, scenario_key, scenario_fingerprint, seed, before_error_rate, before_latency_ms, before_journey_success, evidence_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'modeled')").bind(id, project.id, profile.label, "modeled", profile.before.score, null, profile.before.errorRate, profile.before.latencyMs, profile.before.journeySuccess, 120, scenarioKey, profile.fingerprint, seed, profile.before.errorRate, profile.before.latencyMs, profile.before.journeySuccess).run();
  } catch (error) {
    await db.prepare("UPDATE workspaces SET simulation_minutes = MAX(0, simulation_minutes - ?) WHERE id = ? AND usage_period_start = ?").bind(MODELED_RUN_MINUTES, workspaceId, entitlements.usagePeriodStart).run().catch(() => undefined);
    throw error;
  }
  await recordAudit({ workspaceId, actorEmail: actor, action: "simulation.modeled", targetType: "simulation_run", targetId: id, summary: `${profile.label} planning forecast created`, metadata: { scenario: scenarioKey, fingerprint: profile.fingerprint, modeled: true, beforeScore: profile.before.score } });
  return db.prepare("SELECT * FROM simulation_runs WHERE id = ?").bind(id).first();
}

export async function verifySimulationRun(email: string, runId: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin", "member"]);
  requireWriteEntitlement(snapshot.entitlements);
  return verifySimulationRunForWorkspace(String(snapshot.workspace.id), email, runId);
}

export async function verifySimulationRunForWorkspace(workspaceId: string, actor: string, runId: string) {
  void actor;
  requireWriteEntitlement(await getWorkspaceEntitlements(workspaceId));
  const db = await getD1();
  const run = await db.prepare("SELECT r.* FROM simulation_runs r JOIN projects p ON p.id = r.project_id WHERE r.id = ? AND p.workspace_id = ?").bind(runId, workspaceId).first<{ evidence_kind: string } & Record<string, unknown>>();
  if (!run) throw new Error("Simulation run not found in this workspace");
  if (run.evidence_kind === "observed") return run;
  throw new Error("Modeled planning runs cannot become verified evidence. Submit signed observed runner evidence instead");
}

export async function getSimulationReport(email: string, runId: string) {
  const snapshot = await getSaasSnapshot(email);
  const workspace = snapshot.workspace as { id: string };
  const db = await getD1();
  const run = await db.prepare("SELECT r.*, p.name AS project_name, p.repository, p.branch, p.source_kind, p.repository_verified, w.workspace_mode FROM simulation_runs r JOIN projects p ON p.id = r.project_id JOIN workspaces w ON w.id = p.workspace_id WHERE r.id = ? AND p.workspace_id = ?").bind(runId, workspace.id).first<Record<string, unknown>>();
  if (!run) throw new Error("Verification report not found");
  const observedEvidence = run.workspace_mode === "customer" && run.evidence_kind === "observed";
  const sampleEvidence = run.workspace_mode === "sample" && run.evidence_kind === "sample_fixture";
  if (run.status !== "verified" || (!observedEvidence && !sampleEvidence)) throw new Error("Verification reports require signed observed runner evidence or an isolated sample fixture");
  return run;
}
