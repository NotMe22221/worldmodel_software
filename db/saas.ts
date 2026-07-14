async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export async function ensureSaasSchema() {
  const db = await getD1();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_email TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'trial', simulation_minutes INTEGER NOT NULL DEFAULT 0, monthly_limit INTEGER NOT NULL DEFAULT 500, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, repository TEXT NOT NULL, branch TEXT NOT NULL DEFAULT 'main', status TEXT NOT NULL DEFAULT 'ready', resilience_score INTEGER NOT NULL DEFAULT 0, service_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS simulation_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), scenario TEXT NOT NULL, status TEXT NOT NULL, before_score INTEGER NOT NULL, after_score INTEGER, error_rate TEXT NOT NULL, latency_ms INTEGER NOT NULL, journey_success INTEGER NOT NULL, duration_seconds INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS workspace_members (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL REFERENCES workspaces(id), email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects(workspace_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS runs_project_idx ON simulation_runs(project_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_workspace_email_idx ON workspace_members(workspace_id, email)"),
  ]);
}

export async function seedWorkspace(email: string) {
  const db = await getD1();
  const suffix = [...email.toLowerCase()].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(36);
  const workspaceId = `ws_${suffix}`;
  const projectId = `proj_checkout_${suffix}`;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO workspaces (id, name, owner_email, plan, simulation_minutes, monthly_limit) VALUES (?, ?, ?, ?, ?, ?)").bind(workspaceId, "Northstar Engineering", email, "pro_trial", 214, 500),
    db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, email, role) VALUES (?, ?, ?)").bind(workspaceId, email, "owner"),
    db.prepare("INSERT OR IGNORE INTO projects (id, workspace_id, name, repository, branch, status, resilience_score, service_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(projectId, workspaceId, "Checkout resilience", "shopstream/demo-store", "main", "ready", 94, 7),
    db.prepare("INSERT OR IGNORE INTO simulation_runs (id, project_id, scenario, status, before_score, after_score, error_rate, latency_ms, journey_success, duration_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(`run_payment_${suffix}`, projectId, "Payment outage", "verified", 31, 94, "0.4%", 488, 100, 120, "2026-07-13T23:42:00Z"),
    db.prepare("INSERT OR IGNORE INTO simulation_runs (id, project_id, scenario, status, before_score, after_score, error_rate, latency_ms, journey_success, duration_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(`run_database_${suffix}`, projectId, "Database slowdown", "completed", 38, null, "21.4%", 3190, 54, 120, "2026-07-12T18:20:00Z"),
    db.prepare("INSERT OR IGNORE INTO simulation_runs (id, project_id, scenario, status, before_score, after_score, error_rate, latency_ms, journey_success, duration_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(`run_traffic_${suffix}`, projectId, "Traffic spike", "completed", 42, null, "18.7%", 2840, 61, 120, "2026-07-11T16:08:00Z"),
  ]);
}

export async function getSaasSnapshot(email: string) {
  await ensureSaasSchema();
  await seedWorkspace(email);
  const db = await getD1();
  const workspace = await db.prepare("SELECT * FROM workspaces WHERE owner_email = ? ORDER BY created_at LIMIT 1").bind(email).first<{ id: string } & Record<string, unknown>>();
  if (!workspace) throw new Error("Workspace not found");
  const projects = await db.prepare("SELECT * FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC").bind(workspace.id).all();
  const runs = await db.prepare("SELECT r.*, p.name AS project_name FROM simulation_runs r JOIN projects p ON p.id = r.project_id WHERE p.workspace_id = ? ORDER BY r.created_at DESC LIMIT 20").bind(workspace.id).all();
  const members = await db.prepare("SELECT email, role, created_at FROM workspace_members WHERE workspace_id = ? ORDER BY created_at").bind(workspace.id).all();
  return { workspace, projects: projects.results, runs: runs.results, members: members.results };
}

export async function createProject(email: string, input: { name: string; repository: string; branch: string }) {
  const snapshot = await getSaasSnapshot(email);
  const id = `proj_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const db = await getD1();
  await db.prepare("INSERT INTO projects (id, workspace_id, name, repository, branch, status, resilience_score, service_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, snapshot.workspace.id, input.name, input.repository, input.branch, "scanning", 0, 0).run();
  return db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
}

export async function updateWorkspace(email: string, name: string) {
  const snapshot = await getSaasSnapshot(email);
  const db = await getD1();
  await db.prepare("UPDATE workspaces SET name = ? WHERE id = ? AND owner_email = ?").bind(name, snapshot.workspace.id, email).run();
  return db.prepare("SELECT * FROM workspaces WHERE id = ?").bind(snapshot.workspace.id).first();
}

export async function inviteWorkspaceMember(email: string, memberEmail: string, role: "admin" | "member" | "viewer") {
  const snapshot = await getSaasSnapshot(email);
  const db = await getD1();
  await db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, email, role) VALUES (?, ?, ?)").bind(snapshot.workspace.id, memberEmail, role).run();
  return db.prepare("SELECT email, role, created_at FROM workspace_members WHERE workspace_id = ? AND email = ?").bind(snapshot.workspace.id, memberEmail).first();
}
