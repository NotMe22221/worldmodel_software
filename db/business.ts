import { createProjectForWorkspace, getSaasSnapshot, requireRole } from "./saas";
import type { GithubInstallation, GithubRepository } from "../server/github";
import { recordAudit } from "./audit";
import { repositoryTree } from "../server/github";
import { buildRepositoryGraph } from "../worldmodel/repository-graph.mjs";
import { createModelVersionForProject } from "./product";
import { getRuntimeEnv } from "@/server/runtime-env";
import { githubConnectionStatements, requireImportableGithubRepository, selectGithubRepository } from "./github-app.ts";
import { refreshVerifiedProjectMapping } from "./repository-mapping.ts";

async function getD1() {
  const env = await getRuntimeEnv();
  if (!env.DB) throw new Error("Durable database is unavailable");
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
    ...githubConnectionStatements(db, pending.workspace_id, email, installation, repositories),
    db.prepare("UPDATE integration_states SET used_at = CURRENT_TIMESTAMP WHERE token = ? AND used_at IS NULL").bind(state),
  ];
  await db.batch(statements);
  await recordAudit({ workspaceId: pending.workspace_id, actorEmail: email, action: "github.connected", targetType: "github_installation", targetId: String(installation.id), summary: `Connected GitHub account ${installation.account.login}`, metadata: { repositoryCount: repositories.length, accountType: installation.account.type } });
  return { account: installation.account.login, repositoryCount: repositories.length };
}

export async function importGithubRepository(email: string, repositoryId: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin", "member"]);
  const db = await getD1();
  const repository = await requireImportableGithubRepository(db, String(snapshot.workspace.id), repositoryId);
  const tree = await repositoryTree(repository.installation_id, repository.full_name, repository.default_branch);
  const graph = buildRepositoryGraph(tree.entries, { repository: repository.full_name, branch: repository.default_branch, commitSha: tree.commitSha, truncated: tree.truncated });
  const graphJson = JSON.stringify(graph);
  const scanSummary = `${graph.nodes.length} components from ${graph.scannedPathCount} repository paths${graph.truncated ? " (GitHub tree truncated)" : ""}`;
  const workspaceId = String(snapshot.workspace.id);
  const existing = await db.prepare("SELECT * FROM projects WHERE workspace_id = ? AND lower(repository) = lower(?) LIMIT 1").bind(workspaceId, repository.full_name).first<Record<string, unknown>>();
  if (existing) {
    await refreshVerifiedProjectMapping(db, {
      workspaceId,
      projectId: String(existing.id),
      defaultBranch: repository.default_branch,
      graphJson,
      scanSummary,
      serviceCount: graph.nodes.length,
    });
    const mapped = await db.prepare("SELECT * FROM projects WHERE id = ? AND workspace_id = ?").bind(existing.id, workspaceId).first<Record<string, unknown>>();
    if (!mapped) throw new Error("Verified project mapping was not persisted");
    await selectGithubRepository(db, workspaceId, repositoryId);
    await recordAudit({ workspaceId, actorEmail: email, action: "repository.mapped", targetType: "project", targetId: String(existing.id), summary: `Mapped ${graph.nodes.length} components from ${repository.full_name}`, metadata: { scannedPathCount: graph.scannedPathCount, truncated: graph.truncated } });
    await createModelVersionForProject(db, workspaceId, mapped, { commitSha: tree.commitSha, graph, confidence: graph.truncated ? 70 : 85 });
    return db.prepare("SELECT * FROM projects WHERE id = ?").bind(existing.id).first();
  }
  const name = repository.full_name.split("/").pop()?.replaceAll("-", " ") || repository.full_name;
  const project = await createProjectForWorkspace(workspaceId, email, { name: name.replace(/\b\w/g, (letter) => letter.toUpperCase()), repository: repository.full_name, branch: repository.default_branch, sourceKind: "github", repositoryVerified: true });
  await refreshVerifiedProjectMapping(db, {
    workspaceId,
    projectId: String(project?.id),
    defaultBranch: repository.default_branch,
    graphJson,
    scanSummary,
    serviceCount: graph.nodes.length,
  });
  const mapped = await db.prepare("SELECT * FROM projects WHERE id = ? AND workspace_id = ?").bind(project?.id, workspaceId).first<Record<string, unknown>>();
  if (!mapped) throw new Error("Verified project mapping was not persisted");
  await selectGithubRepository(db, workspaceId, repositoryId);
  await recordAudit({ workspaceId, actorEmail: email, action: "repository.imported", targetType: "github_repository", targetId: repositoryId, summary: `Imported and mapped ${repository.full_name} from GitHub`, metadata: { projectId: String(project?.id || ""), componentCount: graph.nodes.length, scannedPathCount: graph.scannedPathCount, truncated: graph.truncated } });
  await createModelVersionForProject(db, workspaceId, mapped, { commitSha: tree.commitSha, graph, confidence: graph.truncated ? 70 : 85 });
  return db.prepare("SELECT * FROM projects WHERE id = ?").bind(project?.id).first();
}

export async function billingContext(email: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  const db = await getD1();
  const subscription = await db.prepare("SELECT * FROM subscriptions WHERE workspace_id = ?").bind(snapshot.workspace.id).first<{ stripe_customer_id: string | null }>();
  return { workspaceId: String(snapshot.workspace.id), email, customerId: subscription?.stripe_customer_id || null };
}
