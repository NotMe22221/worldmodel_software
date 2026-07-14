import { recordAudit } from "./audit";
import { ensureSaasSchema } from "./saas";
import { hasOperatorAccess } from "../server/runtime-config";

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

async function requireOperator(email: string) {
  if (!(await hasOperatorAccess(email)))
    throw new Error("Operator access is not configured for this account");
}

export async function getOperatorSnapshot(email: string) {
  await requireOperator(email);
  await ensureSaasSchema();
  const db = await getD1();
  const [workspaces, cases, totals] = await Promise.all([
    db
      .prepare(
        "SELECT w.id, w.name, w.workspace_mode, w.plan, w.simulation_minutes, w.monthly_limit, w.trial_ends_at, w.created_at, s.status AS subscription_status, s.plan AS subscription_plan, s.current_period_end, (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count, (SELECT COUNT(*) FROM projects p WHERE p.workspace_id = w.id) AS project_count, (SELECT COUNT(*) FROM simulation_runs r JOIN projects p ON p.id = r.project_id WHERE p.workspace_id = w.id AND r.status = 'verified') AS verified_run_count, (SELECT COUNT(*) FROM support_cases c WHERE c.workspace_id = w.id AND c.status NOT IN ('resolved','closed')) AS open_case_count FROM workspaces w LEFT JOIN subscriptions s ON s.workspace_id = w.id ORDER BY w.created_at DESC LIMIT 250",
      )
      .all(),
    db
      .prepare(
        "SELECT c.id, c.workspace_id, w.name AS workspace_name, c.created_by, c.subject, c.category, c.priority, c.status, c.body, c.operator_note, c.assigned_to, c.resolved_at, c.created_at, c.updated_at FROM support_cases c JOIN workspaces w ON w.id = c.workspace_id ORDER BY CASE c.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'waiting_on_customer' THEN 2 ELSE 3 END, CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, c.updated_at DESC LIMIT 250",
      )
      .all(),
    db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM workspaces) AS workspaces, (SELECT COUNT(*) FROM workspaces WHERE workspace_mode = 'customer') AS customer_workspaces, (SELECT COUNT(*) FROM workspaces WHERE workspace_mode = 'sample') AS sample_workspaces, (SELECT COUNT(*) FROM workspace_members) AS members, (SELECT COUNT(*) FROM simulation_runs r JOIN projects p ON p.id = r.project_id JOIN workspaces w ON w.id = p.workspace_id WHERE w.workspace_mode = 'customer') AS simulations, (SELECT COUNT(*) FROM simulation_runs r JOIN projects p ON p.id = r.project_id JOIN workspaces w ON w.id = p.workspace_id WHERE r.status = 'verified' AND w.workspace_mode = 'customer') AS verified_runs, (SELECT COUNT(*) FROM support_cases WHERE status NOT IN ('resolved','closed')) AS open_cases, (SELECT COALESCE(SUM(simulation_minutes),0) FROM workspaces WHERE workspace_mode = 'customer') AS simulation_minutes, (SELECT COUNT(*) FROM subscriptions s JOIN workspaces w ON w.id = s.workspace_id WHERE s.status IN ('active','trialing') AND w.workspace_mode = 'customer') AS active_subscriptions, (SELECT COUNT(*) FROM workspaces w WHERE w.workspace_mode = 'customer' AND EXISTS (SELECT 1 FROM projects p WHERE p.workspace_id = w.id)) AS activation_repository, (SELECT COUNT(*) FROM workspaces w WHERE w.workspace_mode = 'customer' AND EXISTS (SELECT 1 FROM simulation_runs r JOIN projects p ON p.id = r.project_id WHERE p.workspace_id = w.id)) AS activation_simulation, (SELECT COUNT(*) FROM workspaces w WHERE w.workspace_mode = 'customer' AND EXISTS (SELECT 1 FROM simulation_runs r JOIN projects p ON p.id = r.project_id WHERE p.workspace_id = w.id AND r.status = 'verified')) AS activation_verification, (SELECT COUNT(*) FROM workspaces w WHERE w.workspace_mode = 'customer' AND ((SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = w.id) > 1 OR EXISTS (SELECT 1 FROM workspace_invitations i WHERE i.workspace_id = w.id AND i.status = 'pending' AND datetime(i.expires_at) > CURRENT_TIMESTAMP))) AS activation_team",
      )
      .first(),
  ]);
  return {
    operator: { email },
    totals,
    workspaces: workspaces.results,
    supportCases: cases.results,
    generatedAt: new Date().toISOString(),
  };
}

export async function updateOperatorSupportCase(
  email: string,
  caseId: string,
  status: string,
  note: string,
) {
  await requireOperator(email);
  await ensureSaasSchema();
  const allowed = new Set([
    "open",
    "in_progress",
    "waiting_on_customer",
    "resolved",
    "closed",
  ]);
  if (!allowed.has(status)) throw new Error("Choose a supported case status");
  if (note.trim().length < 5 || note.trim().length > 1000)
    throw new Error(
      "An operator note between 5 and 1000 characters is required",
    );
  const db = await getD1();
  const supportCase = await db
    .prepare(
      "SELECT id, workspace_id, subject, status FROM support_cases WHERE id = ?",
    )
    .bind(caseId)
    .first<{
      id: string;
      workspace_id: string;
      subject: string;
      status: string;
    }>();
  if (!supportCase) throw new Error("Support case not found");
  await db
    .prepare(
      "UPDATE support_cases SET status = ?, operator_note = ?, assigned_to = ?, resolved_at = CASE WHEN ? IN ('resolved','closed') THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(status, note.trim(), email.toLowerCase(), status, caseId)
    .run();
  await recordAudit({
    workspaceId: supportCase.workspace_id,
    actorEmail: email,
    action: "support.status_updated",
    targetType: "support_case",
    targetId: caseId,
    summary: `Support case ${caseId} changed from ${supportCase.status} to ${status}`,
    metadata: {
      previousStatus: supportCase.status,
      status,
      operatorNote: note.trim(),
    },
  });
  return { id: caseId, status, assignedTo: email.toLowerCase() };
}
