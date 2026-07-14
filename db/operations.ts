import { recordAudit } from "./audit";
import { getSaasSnapshot, requireRole } from "./saas";

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export async function createSupportCase(email: string, input: { subject: string; category: string; priority: string; body: string }) {
  const snapshot = await getSaasSnapshot(email);
  const workspaceId = String(snapshot.workspace.id);
  const id = `case_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const db = await getD1();
  await db.prepare("INSERT INTO support_cases (id, workspace_id, created_by, subject, category, priority, status, body) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)").bind(id, workspaceId, email.toLowerCase(), input.subject, input.category, input.priority, input.body).run();
  await recordAudit({ workspaceId, actorEmail: email, action: "support.created", targetType: "support_case", targetId: id, summary: `Opened support case: ${input.subject}`, metadata: { category: input.category, priority: input.priority } });
  return db.prepare("SELECT id, created_by, subject, category, priority, status, created_at, updated_at FROM support_cases WHERE id = ?").bind(id).first();
}

export async function getAuditRows(email: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  const db = await getD1();
  const rows = await db.prepare("SELECT id, actor_email, action, target_type, target_id, summary, created_at FROM audit_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 5000").bind(snapshot.workspace.id).all();
  return rows.results;
}

export async function exportWorkspaceData(email: string) {
  const snapshot = await getSaasSnapshot(email);
  const role = String((snapshot.workspace as Record<string, unknown>).membership_role || "viewer");
  const db = await getD1();
  const generatedAt = new Date().toISOString();
  if (role !== "owner" && role !== "admin") {
    const supportCases = await db.prepare("SELECT id, subject, category, priority, status, body, created_at, updated_at FROM support_cases WHERE workspace_id = ? AND lower(created_by) = lower(?) ORDER BY created_at").bind(snapshot.workspace.id, email).all();
    const auditEvents = await db.prepare("SELECT id, action, target_type, target_id, summary, created_at FROM audit_logs WHERE workspace_id = ? AND lower(actor_email) = lower(?) ORDER BY created_at").bind(snapshot.workspace.id, email).all();
    return { exportVersion: 1, generatedAt, scope: "current-user", account: { email, workspaceId: snapshot.workspace.id, role }, supportCases: supportCases.results, auditEvents: auditEvents.results };
  }
  const workspaceId = snapshot.workspace.id;
  const [supportCases, auditEvents, subscription, deletionRequests] = await Promise.all([
    db.prepare("SELECT id, created_by, subject, category, priority, status, body, created_at, updated_at FROM support_cases WHERE workspace_id = ? ORDER BY created_at").bind(workspaceId).all(),
    db.prepare("SELECT id, actor_email, action, target_type, target_id, summary, metadata_json, created_at FROM audit_logs WHERE workspace_id = ? ORDER BY created_at").bind(workspaceId).all(),
    db.prepare("SELECT stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, updated_at FROM subscriptions WHERE workspace_id = ?").bind(workspaceId).first(),
    db.prepare("SELECT id, requested_by, scope, status, reason, execute_after, created_at, canceled_at, completed_at FROM data_deletion_requests WHERE workspace_id = ? ORDER BY created_at").bind(workspaceId).all(),
  ]);
  return { exportVersion: 1, generatedAt, scope: "workspace", workspace: snapshot.workspace, entitlements: snapshot.entitlements, members: snapshot.members, pendingInvitations: snapshot.pendingInvitations, projects: snapshot.projects, simulationRuns: snapshot.runs, githubInstallations: snapshot.githubInstallations, githubRepositories: snapshot.githubRepositories, subscription, supportCases: supportCases.results, auditEvents: auditEvents.results, launchChecks: snapshot.launchChecks, deletionRequests: deletionRequests.results, apiKeys: snapshot.apiKeys, apiUsage: snapshot.apiUsage };
}

export async function requestWorkspaceDeletion(email: string, reason?: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner"]);
  const workspaceId = String(snapshot.workspace.id);
  const db = await getD1();
  const existing = await db.prepare("SELECT * FROM data_deletion_requests WHERE workspace_id = ? AND status = 'pending' LIMIT 1").bind(workspaceId).first();
  if (existing) throw new Error("A workspace deletion request is already pending");
  const id = `del_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
  const executeAfter = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
  await db.prepare("INSERT INTO data_deletion_requests (id, workspace_id, requested_by, scope, status, reason, execute_after) VALUES (?, ?, ?, 'workspace', 'pending', ?, ?)").bind(id, workspaceId, email.toLowerCase(), reason || null, executeAfter).run();
  await recordAudit({ workspaceId, actorEmail: email, action: "deletion.requested", targetType: "workspace", targetId: workspaceId, summary: "Requested workspace deletion review", metadata: { executeAfter } });
  return db.prepare("SELECT id, scope, status, reason, execute_after, created_at, canceled_at, completed_at FROM data_deletion_requests WHERE id = ?").bind(id).first();
}

export async function cancelWorkspaceDeletion(email: string, requestId: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner"]);
  const workspaceId = String(snapshot.workspace.id);
  const db = await getD1();
  const result = await db.prepare("UPDATE data_deletion_requests SET status = 'canceled', canceled_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ? AND status = 'pending'").bind(requestId, workspaceId).run();
  if (!result.meta.changes) throw new Error("Pending deletion request not found");
  await recordAudit({ workspaceId, actorEmail: email, action: "deletion.canceled", targetType: "workspace", targetId: workspaceId, summary: "Canceled workspace deletion request", metadata: { requestId } });
  return db.prepare("SELECT id, scope, status, reason, execute_after, created_at, canceled_at, completed_at FROM data_deletion_requests WHERE id = ?").bind(requestId).first();
}

const manualLaunchChecks = new Set(["legal_review", "security_review", "incident_plan", "support_owner"]);

export async function setLaunchCheck(email: string, input: { key: string; passed: boolean; evidence: string }) {
  if (!manualLaunchChecks.has(input.key)) throw new Error("Unsupported launch readiness check");
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner"]);
  const workspaceId = String(snapshot.workspace.id);
  const id = `${workspaceId}:${input.key}`;
  const db = await getD1();
  await db.prepare("INSERT INTO launch_checks (id, workspace_id, check_key, passed, evidence, attested_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, check_key) DO UPDATE SET passed = excluded.passed, evidence = excluded.evidence, attested_by = excluded.attested_by, updated_at = CURRENT_TIMESTAMP").bind(id, workspaceId, input.key, input.passed ? 1 : 0, input.evidence || null, email.toLowerCase()).run();
  await recordAudit({ workspaceId, actorEmail: email, action: "readiness.attested", targetType: "launch_check", targetId: input.key, summary: `${input.key.replaceAll("_", " ")} marked ${input.passed ? "complete" : "incomplete"}`, metadata: { passed: input.passed } });
  return db.prepare("SELECT check_key, passed, evidence, updated_at FROM launch_checks WHERE workspace_id = ? AND check_key = ?").bind(workspaceId, input.key).first();
}
