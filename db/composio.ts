import { createProject, ensureSaasSchema, getSaasSnapshot, requireRole } from "./saas.ts";
import { recordAudit } from "./audit.ts";
import { createModelVersion } from "./product.ts";
import { getRuntimeEnv } from "../server/runtime-env.ts";
import { composioConfiguration } from "../server/runtime-config.ts";
import {
  createComposioGithubLink,
  getComposioConnectedAccount,
  getComposioGithubIdentity,
  getComposioGithubTree,
  listComposioGithubRepositories,
  revokeComposioConnection,
} from "../server/composio.ts";
import { buildRepositoryGraph } from "../worldmodel/repository-graph.mjs";

async function getD1() {
  const env = await getRuntimeEnv();
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function composioUserId(workspaceId: string, email: string) {
  return `wm_${(await sha256(`worldmodel:${workspaceId}:${email.toLowerCase()}`)).slice(0, 40)}`;
}

export async function beginComposioGithubConnection(email: string, callbackUrl: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  const config = await composioConfiguration();
  const workspaceId = String(snapshot.workspace.id);
  const userId = await composioUserId(workspaceId, email);
  const state = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const stateHash = await sha256(state);
  const callback = new URL(callbackUrl);
  callback.searchParams.set("state", state);
  const link = await createComposioGithubLink(userId, callback.toString());
  const hardExpiry = Date.now() + 10 * 60_000;
  const providerExpiry = Date.parse(link.expiresAt);
  const expiresAt = new Date(Number.isFinite(providerExpiry) ? Math.min(hardExpiry, providerExpiry) : hardExpiry).toISOString();
  const db = await getD1();
  await db.prepare("DELETE FROM composio_connection_attempts WHERE used_at IS NOT NULL OR expires_at < ?").bind(new Date().toISOString()).run();
  await db.prepare("INSERT INTO composio_connection_attempts (state_hash, workspace_id, created_by, composio_user_id, connected_account_id, auth_config_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(stateHash, workspaceId, email.toLowerCase(), userId, link.connectedAccountId, config.githubAuthConfigId, expiresAt).run();
  await recordAudit({ workspaceId, actorEmail: email, action: "composio.github.started", targetType: "integration", targetId: link.connectedAccountId, summary: "Started a hosted GitHub connection through Composio", metadata: { authConfigId: config.githubAuthConfigId } });
  return { redirectUrl: link.redirectUrl, connectedAccountId: link.connectedAccountId, expiresAt };
}

type ConnectionRecord = {
  id: string;
  workspace_id: string;
  connected_account_id: string;
  composio_user_id: string;
  auth_config_id: string;
  provider_login: string;
  status: string;
};

type PendingConnection = {
  state_hash: string;
  workspace_id: string;
  created_by: string;
  composio_user_id: string;
  connected_account_id: string | null;
  auth_config_id: string;
  expires_at: string;
  used_at: string | null;
};

async function syncConnection(connection: ConnectionRecord) {
  if (connection.status !== "active") throw new Error("Composio GitHub connection is not active");
  const repositories = await listComposioGithubRepositories(connection.connected_account_id, connection.composio_user_id);
  const db = await getD1();
  if (repositories.length) {
    await db.batch(repositories.map((repository) => {
      const id = `cmprepo_${connection.id.slice(-12)}_${repository.id}`;
      return db.prepare("INSERT INTO composio_github_repositories (id, connection_id, workspace_id, repository_id, full_name, default_branch, is_private, html_url, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET full_name = excluded.full_name, default_branch = excluded.default_branch, is_private = excluded.is_private, html_url = excluded.html_url, synced_at = CURRENT_TIMESTAMP").bind(id, connection.id, connection.workspace_id, repository.id, repository.fullName, repository.defaultBranch, repository.isPrivate ? 1 : 0, repository.htmlUrl);
    }));
  }
  await db.prepare("UPDATE composio_connections SET last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(connection.id, connection.workspace_id).run();
  return repositories;
}

async function persistVerifiedConnection(email: string, pending: PendingConnection) {
  if (!pending.connected_account_id) throw new Error("Composio connection account is missing");
  const account = await getComposioConnectedAccount(pending.connected_account_id);
  if (account.id !== pending.connected_account_id || account.userId !== pending.composio_user_id || account.authConfigId !== pending.auth_config_id || account.toolkitSlug.toLowerCase() !== "github" || !["ACTIVE", "CONNECTED"].includes(account.status)) throw new Error("Composio did not return the authorized GitHub connection");
  const identity = await getComposioGithubIdentity(account.id, account.userId).catch(() => ({ login: "GitHub account" }));
  const connectionId = `cmp_${(await sha256(`${pending.workspace_id}:${account.id}`)).slice(0, 24)}`;
  const db = await getD1();
  await db.prepare("INSERT INTO composio_connections (id, workspace_id, connected_account_id, composio_user_id, auth_config_id, toolkit_slug, provider_login, status, connected_by) VALUES (?, ?, ?, ?, ?, 'github', ?, 'active', ?) ON CONFLICT(workspace_id, connected_account_id) DO UPDATE SET composio_user_id = excluded.composio_user_id, auth_config_id = excluded.auth_config_id, provider_login = excluded.provider_login, status = 'active', connected_by = excluded.connected_by, updated_at = CURRENT_TIMESTAMP").bind(connectionId, pending.workspace_id, account.id, account.userId, account.authConfigId, identity.login, email.toLowerCase()).run();
  const connection = await db.prepare("SELECT id, workspace_id, connected_account_id, composio_user_id, auth_config_id, provider_login, status FROM composio_connections WHERE workspace_id = ? AND connected_account_id = ?").bind(pending.workspace_id, account.id).first<ConnectionRecord>();
  if (!connection) throw new Error("Composio GitHub connection could not be persisted");
  const repositories = await syncConnection(connection);
  await recordAudit({ workspaceId: pending.workspace_id, actorEmail: email, action: "composio.github.connected", targetType: "composio_connection", targetId: connection.id, summary: `Connected ${identity.login} through Composio`, metadata: { repositoryCount: repositories.length, connectedAccountId: account.id } });
  return { connectionId: connection.id, account: identity.login, repositoryCount: repositories.length };
}

export async function completeComposioGithubConnection(email: string | null, state: string) {
  await ensureSaasSchema();
  const db = await getD1();
  const stateHash = await sha256(state);
  const pending = await db.prepare("SELECT state_hash, workspace_id, created_by, composio_user_id, connected_account_id, auth_config_id, expires_at, used_at FROM composio_connection_attempts WHERE state_hash = ?").bind(stateHash).first<PendingConnection>();
  if (!pending || pending.used_at || (email && pending.created_by !== email.toLowerCase()) || Date.parse(pending.expires_at) <= Date.now() || !pending.connected_account_id) throw new Error("Composio connection state is invalid or expired");
  const consumed = await db.prepare("UPDATE composio_connection_attempts SET used_at = CURRENT_TIMESTAMP WHERE state_hash = ? AND used_at IS NULL").bind(stateHash).run();
  if (!consumed.meta.changes) throw new Error("Composio connection state was already used");
  return persistVerifiedConnection(email || pending.created_by, pending);
}

export async function recoverComposioGithubConnection(email: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  const config = await composioConfiguration();
  const workspaceId = String(snapshot.workspace.id);
  const expectedUserId = await composioUserId(workspaceId, email);
  const db = await getD1();
  const pending = (await db.prepare("SELECT state_hash, workspace_id, created_by, composio_user_id, connected_account_id, auth_config_id, expires_at, used_at FROM composio_connection_attempts WHERE workspace_id=? AND lower(created_by)=lower(?) AND composio_user_id=? AND auth_config_id=? AND used_at IS NULL AND connected_account_id IS NOT NULL ORDER BY created_at DESC LIMIT 5").bind(workspaceId, email, expectedUserId, config.githubAuthConfigId).all<PendingConnection>()).results;
  for (const candidate of pending) {
    try {
      const recovered = await persistVerifiedConnection(email, candidate);
      await db.prepare("UPDATE composio_connection_attempts SET used_at=CURRENT_TIMESTAMP WHERE state_hash=? AND used_at IS NULL").bind(candidate.state_hash).run();
      await recordAudit({ workspaceId, actorEmail: email, action: "composio.github.recovered", targetType: "composio_connection", targetId: recovered.connectionId, summary: "Recovered a completed GitHub OAuth callback after the browser session changed hosts" });
      return recovered;
    } catch {}
  }
  return null;
}

export async function syncComposioGithubConnection(email: string, connectionId: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin", "member"]);
  const db = await getD1();
  const connection = await db.prepare("SELECT id, workspace_id, connected_account_id, composio_user_id, auth_config_id, provider_login, status FROM composio_connections WHERE id = ? AND workspace_id = ?").bind(connectionId, snapshot.workspace.id).first<ConnectionRecord>();
  if (!connection) throw new Error("Composio GitHub connection was not found in this workspace");
  const repositories = await syncConnection(connection);
  await recordAudit({ workspaceId: connection.workspace_id, actorEmail: email, action: "composio.github.synced", targetType: "composio_connection", targetId: connection.id, summary: `Synchronized ${repositories.length} GitHub repositories through Composio`, metadata: { repositoryCount: repositories.length } });
  return repositories;
}

export async function importComposioGithubRepository(email: string, repositoryRowId: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin", "member"]);
  const db = await getD1();
  const repository = await db.prepare("SELECT r.id, r.repository_id, r.full_name, r.default_branch, r.connection_id, c.connected_account_id, c.composio_user_id, c.status FROM composio_github_repositories r JOIN composio_connections c ON c.id = r.connection_id AND c.workspace_id = r.workspace_id WHERE r.id = ? AND r.workspace_id = ?").bind(repositoryRowId, snapshot.workspace.id).first<{ id: string; repository_id: string; full_name: string; default_branch: string; connection_id: string; connected_account_id: string; composio_user_id: string; status: string }>();
  if (!repository) throw new Error("Composio GitHub repository was not found in this workspace");
  if (repository.status !== "active") throw new Error("Composio GitHub connection is not active");
  const tree = await getComposioGithubTree(repository.connected_account_id, repository.composio_user_id, repository.full_name, repository.default_branch);
  const graph = buildRepositoryGraph(tree.entries, { repository: repository.full_name, branch: repository.default_branch, commitSha: tree.commitSha, truncated: tree.truncated });
  const graphJson = JSON.stringify(graph);
  const scanSummary = `${graph.nodes.length} components from ${graph.scannedPathCount} paths at ${tree.commitSha.slice(0, 12)} through Composio${graph.truncated ? " (tree truncated)" : ""}`;
  const existing = await db.prepare("SELECT * FROM projects WHERE workspace_id = ? AND lower(repository) = lower(?) LIMIT 1").bind(snapshot.workspace.id, repository.full_name).first<Record<string, unknown>>();
  let projectId: string;
  if (existing) {
    projectId = String(existing.id);
    await db.prepare("UPDATE projects SET source_kind = 'github', repository_verified = 1, graph_json = ?, scan_summary = ?, scanned_at = CURRENT_TIMESTAMP, service_count = ?, status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(graphJson, scanSummary, graph.nodes.length, projectId, snapshot.workspace.id).run();
  } else {
    const name = repository.full_name.split("/").pop()?.replaceAll("-", " ") || repository.full_name;
    const project = await createProject(email, { name: name.replace(/\b\w/g, (letter) => letter.toUpperCase()), repository: repository.full_name, branch: repository.default_branch, sourceKind: "github", repositoryVerified: true });
    projectId = String(project?.id);
    await db.prepare("UPDATE projects SET graph_json = ?, scan_summary = ?, scanned_at = CURRENT_TIMESTAMP, service_count = ?, status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(graphJson, scanSummary, graph.nodes.length, projectId, snapshot.workspace.id).run();
  }
  await db.prepare("UPDATE composio_github_repositories SET selected = 1, synced_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(repositoryRowId, snapshot.workspace.id).run();
  await createModelVersion(email, projectId, { commitSha: tree.commitSha, graph, confidence: graph.truncated ? 78 : 90 });
  await recordAudit({ workspaceId: String(snapshot.workspace.id), actorEmail: email, action: "composio.repository.imported", targetType: "project", targetId: projectId, summary: `Imported and mapped ${repository.full_name} through Composio`, metadata: { connectionId: repository.connection_id, repositoryId: repository.repository_id, commitSha: tree.commitSha, componentCount: graph.nodes.length } });
  return db.prepare("SELECT * FROM projects WHERE id = ? AND workspace_id = ?").bind(projectId, snapshot.workspace.id).first();
}

export async function disconnectComposioGithub(email: string, connectionId: string) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  const db = await getD1();
  const connection = await db.prepare("SELECT id, workspace_id, connected_account_id FROM composio_connections WHERE id = ? AND workspace_id = ? AND status = 'active'").bind(connectionId, snapshot.workspace.id).first<{ id: string; workspace_id: string; connected_account_id: string }>();
  if (!connection) throw new Error("Composio GitHub connection was not found in this workspace");
  await revokeComposioConnection(connection.connected_account_id);
  await db.prepare("UPDATE composio_connections SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(connection.id, connection.workspace_id).run();
  await recordAudit({ workspaceId: connection.workspace_id, actorEmail: email, action: "composio.github.disconnected", targetType: "composio_connection", targetId: connection.id, summary: "Revoked the Composio GitHub connection", metadata: {} });
  return { disconnected: true };
}
