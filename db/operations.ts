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
