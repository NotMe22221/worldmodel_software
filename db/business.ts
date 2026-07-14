import { createProject, ensureSaasSchema, getSaasSnapshot, requireRole } from "./saas";
import type { GithubInstallation, GithubRepository } from "../server/github";

async function getD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export async function beginGithubConnection(email: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const db = await getD1();
  await db.prepare("DELETE FROM integration_states WHERE used_at IS NOT NULL OR expires_at < ?").bind(new Date().toISOString()).run();
  await db.prepare("INSERT INTO integration_states (token, workspace_id, purpose, created_by, expires_at) VALUES (?, ?, 'github', ?, ?)").bind(token, snapshot.workspace.id, email.toLowerCase(), expiresAt).run();
  return token;
}

export async function attachGithubInstallation(email: string, state: string, installationId: string) {
  const db = await getD1();
  const record = await db.prepare("SELECT * FROM integration_states WHERE token = ? AND purpose = 'github' AND used_at IS NULL").bind(state).first<{ created_by: string; expires_at: string }>();
  if (!record || record.created_by !== email.toLowerCase() || Date.parse(record.expires_at) <= Date.now()) throw new Error("GitHub connection state is invalid or expired");
  await db.prepare("UPDATE integration_states SET installation_id = ? WHERE token = ?").bind(installationId, state).run();
}

export async function pendingGithubConnection(email: string, state: string) {
  const db = await getD1();
  const record = await db.prepare("SELECT token, workspace_id, installation_id, created_by, expires_at, used_at FROM integration_states WHERE token = ? AND purpose = 'github'").bind(state).first<{ token: string; workspace_id: string; installation_id: string | null; created_by: string; expires_at: string; used_at: string | null }>();
  if (!record || record.used_at || record.created_by !== email.toLowerCase() || Date.parse(record.expires_at) <= Date.now() || !record.installation_id) throw new Error("GitHub connection state is invalid or expired");
  return record;
}

export async function completeGithubConnection(email: string, state: string, installation: GithubInstallation, repositories: GithubRepository[]) {
  const pending = await pendingGithubConnection(email, state);
  if (String(installation.id) !== pending.installation_id) throw new Error("GitHub installation did not match the authorized connection");
  const db = await getD1();
  const statements = [
    db.prepare("INSERT INTO github_installations (installation_id, workspace_id, account_login, account_type, repository_selection, permissions_json, status, connected_by) VALUES (?, ?, ?, ?, ?, ?, 'active', ?) ON CONFLICT(installation_id) DO UPDATE SET workspace_id = excluded.workspace_id, account_login = excluded.account_login, account_type = excluded.account_type, repository_selection = excluded.repository_selection, permissions_json = excluded.permissions_json, status = 'active', connected_by = excluded.connected_by, updated_at = CURRENT_TIMESTAMP").bind(String(installation.id), pending.workspace_id, installation.account.login, installation.account.type, installation.repository_selection, JSON.stringify(installation.permissions), email.toLowerCase()),
    ...repositories.map((repository) => db.prepare("INSERT INTO github_repositories (repository_id, installation_id, workspace_id, full_name, default_branch, is_private, synced_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(repository_id) DO UPDATE SET installation_id = excluded.installation_id, workspace_id = excluded.workspace_id, full_name = excluded.full_name, default_branch = excluded.default_branch, is_private = excluded.is_private, synced_at = CURRENT_TIMESTAMP").bind(String(repository.id), String(installation.id), pending.workspace_id, repository.full_name, repository.default_branch, repository.private ? 1 : 0)),
    db.prepare("UPDATE integration_states SET used_at = CURRENT_TIMESTAMP WHERE token = ? AND used_at IS NULL").bind(state),
  ];
  await db.batch(statements);
  return { account: installation.account.login, repositoryCount: repositories.length };
}

export async function importGithubRepository(email: string, repositoryId: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin", "member"]);
  const db = await getD1();
  const repository = await db.prepare("SELECT repository_id, full_name, default_branch FROM github_repositories WHERE repository_id = ? AND workspace_id = ?").bind(repositoryId, snapshot.workspace.id).first<{ repository_id: string; full_name: string; default_branch: string }>();
  if (!repository) throw new Error("GitHub repository was not found in this workspace");
  const existing = await db.prepare("SELECT * FROM projects WHERE workspace_id = ? AND lower(repository) = lower(?) LIMIT 1").bind(snapshot.workspace.id, repository.full_name).first();
  if (existing) return existing;
  const name = repository.full_name.split("/").pop()?.replaceAll("-", " ") || repository.full_name;
  const project = await createProject(email, { name: name.replace(/\b\w/g, (letter) => letter.toUpperCase()), repository: repository.full_name, branch: repository.default_branch });
  await db.prepare("UPDATE github_repositories SET selected = 1 WHERE repository_id = ? AND workspace_id = ?").bind(repositoryId, snapshot.workspace.id).run();
  return project;
}

export async function billingContext(email: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  const db = await getD1();
  const subscription = await db.prepare("SELECT * FROM subscriptions WHERE workspace_id = ?").bind(snapshot.workspace.id).first<{ stripe_customer_id: string | null }>();
  return { workspaceId: String(snapshot.workspace.id), email, customerId: subscription?.stripe_customer_id || null };
}

type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

export async function processStripeEvent(event: StripeEvent) {
  await ensureSaasSchema();
  const db = await getD1();
  const processed = await db.prepare("SELECT event_id FROM billing_events WHERE event_id = ?").bind(event.id).first();
  if (processed) return { duplicate: true };
  const object = event.data.object;
  const metadata = object.metadata && typeof object.metadata === "object" ? object.metadata as Record<string, unknown> : {};
  const workspaceId = stringField(metadata, "workspace_id") || stringField(object, "client_reference_id");
  if (!workspaceId) { await db.prepare("INSERT OR IGNORE INTO billing_events (event_id, event_type) VALUES (?, ?)").bind(event.id, event.type).run(); return { ignored: true }; }
  const workspace = await db.prepare("SELECT id FROM workspaces WHERE id = ?").bind(workspaceId).first();
  if (!workspace) { await db.prepare("INSERT OR IGNORE INTO billing_events (event_id, event_type) VALUES (?, ?)").bind(event.id, event.type).run(); return { ignored: true }; }
  const plan = stringField(metadata, "plan") || "pro";
  const customer = typeof object.customer === "string" ? object.customer : null;
  const subscriptionId = event.type === "checkout.session.completed" ? (typeof object.subscription === "string" ? object.subscription : null) : stringField(object, "id");
  const status = event.type === "customer.subscription.deleted" ? "canceled" : stringField(object, "status") || (event.type === "checkout.session.completed" ? "pending" : "active");
  const periodEnd = typeof object.current_period_end === "number" ? new Date(object.current_period_end * 1000).toISOString() : null;
  await db.prepare("INSERT INTO subscriptions (workspace_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id), stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id), status = excluded.status, plan = excluded.plan, current_period_end = excluded.current_period_end, updated_at = CURRENT_TIMESTAMP").bind(workspaceId, customer, subscriptionId, status, plan, periodEnd).run();
  const active = status === "active" || status === "trialing";
  const limit = active ? plan === "starter" ? 150 : plan === "business" ? 2000 : 500 : 50;
  await db.prepare("UPDATE workspaces SET plan = ?, monthly_limit = ? WHERE id = ?").bind(active ? plan : "free", limit, workspaceId).run();
  await db.prepare("INSERT OR IGNORE INTO billing_events (event_id, event_type) VALUES (?, ?)").bind(event.id, event.type).run();
  return { duplicate: false, workspaceId, status };
}
