import { createProjectForWorkspace, ensureSaasSchema, getSaasSnapshot, requireRole } from "./saas.ts";
import { recordAudit } from "./audit.ts";
import { createModelVersionForProject } from "./product.ts";
import { getRuntimeEnv } from "../server/runtime-env.ts";
import {
  createComposioGithubLink,
  getComposioConnectedAccount,
  getComposioGithubIdentity,
  getComposioGithubTree,
  listComposioGithubRepositories,
  resolveComposioGithubAuthConfigId,
  revokeComposioConnection,
  type ComposioGithubRepository,
} from "../server/composio.ts";
import { buildRepositoryGraph } from "../worldmodel/repository-graph.mjs";
import {
  claimComposioConnectionAttempt,
  cleanupComposioConnectionAttempts,
  finalizeComposioConnectionAttempt,
  getComposioConnectionAttempt,
  newestRecoverableComposioConnectionAttempt,
  releaseComposioConnectionAttempt,
  type PendingConnectionAttempt,
} from "../server/composio-attempts.ts";
import { refreshVerifiedProjectMapping } from "./repository-mapping.ts";

async function getD1() {
  const env = await getRuntimeEnv();
  if (!env.DB) throw new Error("Durable database is unavailable");
  return env.DB;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function composioUserId(workspaceId: string, email: string) {
  return `wm_${(await sha256(`worldmodel:${workspaceId}:${email.toLowerCase()}`)).slice(0, 40)}`;
}

type LifecycleLogDetails = {
  workspaceId?: string;
  outcome?: "started" | "claimed" | "connected" | "released" | "not_found";
  reason?: "provider_failure" | "state_changed" | "no_recoverable_attempt";
};

function lifecycleLog(level: "info" | "warn", event: string, correlationId: string, details: LifecycleLogDetails = {}) {
  const payload = JSON.stringify({ component: "composio_github", event, correlationId, ...details });
  if (level === "warn") console.warn(payload);
  else console.info(payload);
}

export async function beginComposioGithubConnection(email: string, callbackUrl: string, correlationId = crypto.randomUUID()) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
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
  await cleanupComposioConnectionAttempts(db, new Date().toISOString());
  await db.prepare("INSERT INTO composio_connection_attempts (state_hash, workspace_id, created_by, composio_user_id, connected_account_id, auth_config_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(stateHash, workspaceId, email.toLowerCase(), userId, link.connectedAccountId, link.authConfigId, expiresAt).run();
  await recordAudit({ workspaceId, actorEmail: email, action: "composio.github.started", targetType: "integration", targetId: link.connectedAccountId, summary: "Started a hosted GitHub connection through Composio", metadata: { authConfigId: link.authConfigId } });
  lifecycleLog("info", "connection_start", correlationId, { workspaceId, outcome: "started" });
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

async function persistRepositories(connection: ConnectionRecord, repositories: ComposioGithubRepository[]) {
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

async function syncConnection(connection: ConnectionRecord) {
  if (connection.status !== "active") throw new Error("Composio GitHub connection is not active");
  const repositories = await listComposioGithubRepositories(connection.connected_account_id, connection.composio_user_id);
  return persistRepositories(connection, repositories);
}

async function persistVerifiedConnection(email: string, pending: PendingConnectionAttempt) {
  if (!pending.connected_account_id) throw new Error("Composio connection account is missing");
  const account = await getComposioConnectedAccount(pending.connected_account_id);
  if (account.id !== pending.connected_account_id || account.userId !== pending.composio_user_id || account.authConfigId !== pending.auth_config_id || account.toolkitSlug.toLowerCase() !== "github" || !["ACTIVE", "CONNECTED"].includes(account.status)) throw new Error("Composio did not return the authorized GitHub connection");
  const [identity, repositories] = await Promise.all([
    getComposioGithubIdentity(account.id, account.userId).catch(() => ({ login: "GitHub account" })),
    listComposioGithubRepositories(account.id, account.userId),
  ]);
  const connectionId = `cmp_${(await sha256(`${pending.workspace_id}:${account.id}`)).slice(0, 24)}`;
  const db = await getD1();
  await db.prepare("INSERT INTO composio_connections (id, workspace_id, connected_account_id, composio_user_id, auth_config_id, toolkit_slug, provider_login, status, connected_by) VALUES (?, ?, ?, ?, ?, 'github', ?, 'active', ?) ON CONFLICT(workspace_id, connected_account_id) DO UPDATE SET composio_user_id = excluded.composio_user_id, auth_config_id = excluded.auth_config_id, provider_login = excluded.provider_login, status = 'active', connected_by = excluded.connected_by, updated_at = CURRENT_TIMESTAMP").bind(connectionId, pending.workspace_id, account.id, account.userId, account.authConfigId, identity.login, email.toLowerCase()).run();
  const connection = await db.prepare("SELECT id, workspace_id, connected_account_id, composio_user_id, auth_config_id, provider_login, status FROM composio_connections WHERE workspace_id = ? AND connected_account_id = ?").bind(pending.workspace_id, account.id).first<ConnectionRecord>();
  if (!connection) throw new Error("Composio GitHub connection could not be persisted");
  await persistRepositories(connection, repositories);
  await recordAudit({ workspaceId: pending.workspace_id, actorEmail: email, action: "composio.github.connected", targetType: "composio_connection", targetId: connection.id, summary: `Connected ${identity.login} through Composio`, metadata: { repositoryCount: repositories.length, connectedAccountId: account.id } });
  return { connectionId: connection.id, account: identity.login, repositoryCount: repositories.length };
}

async function claimAndPersistConnection(email: string, pending: PendingConnectionAttempt, correlationId: string) {
  const db = await getD1();
  const now = new Date().toISOString();
  const claim = await claimComposioConnectionAttempt(db, pending.state_hash, now, correlationId);
  if (!claim) throw new Error("Composio connection state is invalid, expired, or already in use");
  lifecycleLog("info", "connection_attempt", correlationId, { workspaceId: pending.workspace_id, outcome: "claimed" });
  try {
    const connected = await persistVerifiedConnection(email, pending);
    const finalized = await finalizeComposioConnectionAttempt(db, pending.state_hash, claim);
    if (!finalized) {
      lifecycleLog("warn", "connection_attempt", correlationId, { workspaceId: pending.workspace_id, reason: "state_changed" });
      throw new Error("Composio connection state changed before it could be finalized");
    }
    lifecycleLog("info", "connection_complete", correlationId, { workspaceId: pending.workspace_id, outcome: "connected" });
    return connected;
  } catch (error) {
    const released = await releaseComposioConnectionAttempt(db, pending.state_hash, claim, new Date().toISOString());
    if (released) lifecycleLog("warn", "connection_attempt", correlationId, { workspaceId: pending.workspace_id, outcome: "released", reason: "provider_failure" });
    throw error;
  }
}

export async function completeComposioGithubConnection(email: string | null, state: string, correlationId = crypto.randomUUID()) {
  await ensureSaasSchema();
  const db = await getD1();
  const stateHash = await sha256(state);
  const pending = await getComposioConnectionAttempt(db, stateHash);
  if (!pending || pending.used_at || (email && pending.created_by !== email.toLowerCase()) || Date.parse(pending.expires_at) <= Date.now() || !pending.connected_account_id) throw new Error("Composio connection state is invalid or expired");
  return claimAndPersistConnection(email || pending.created_by, pending, correlationId);
}

export async function recoverComposioGithubConnection(email: string, correlationId = crypto.randomUUID()) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  const authConfigId = await resolveComposioGithubAuthConfigId();
  const workspaceId = String(snapshot.workspace.id);
  const expectedUserId = await composioUserId(workspaceId, email);
  const db = await getD1();
  const now = new Date().toISOString();
  await cleanupComposioConnectionAttempts(db, now);
  const candidate = await newestRecoverableComposioConnectionAttempt(db, { workspaceId, email, composioUserId: expectedUserId, authConfigId, now });
  if (!candidate) {
    lifecycleLog("info", "connection_recovery", correlationId, { workspaceId, outcome: "not_found", reason: "no_recoverable_attempt" });
    return null;
  }
  try {
    const recovered = await claimAndPersistConnection(email, candidate, correlationId);
    await recordAudit({ workspaceId, actorEmail: email, action: "composio.github.recovered", targetType: "composio_connection", targetId: recovered.connectionId, summary: "Recovered a completed GitHub OAuth callback after the browser session changed hosts" });
    return recovered;
  } catch {
    lifecycleLog("info", "connection_recovery", correlationId, { workspaceId, outcome: "not_found", reason: "provider_failure" });
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
  const workspaceId = String(snapshot.workspace.id);
  const existing = await db.prepare("SELECT * FROM projects WHERE workspace_id = ? AND lower(repository) = lower(?) LIMIT 1").bind(workspaceId, repository.full_name).first<Record<string, unknown>>();
  let projectId: string;
  if (existing) {
    projectId = String(existing.id);
    await refreshVerifiedProjectMapping(db, {
      workspaceId,
      projectId,
      defaultBranch: repository.default_branch,
      graphJson,
      scanSummary,
      serviceCount: graph.nodes.length,
    });
  } else {
    const name = repository.full_name.split("/").pop()?.replaceAll("-", " ") || repository.full_name;
    const project = await createProjectForWorkspace(workspaceId, email, { name: name.replace(/\b\w/g, (letter) => letter.toUpperCase()), repository: repository.full_name, branch: repository.default_branch, sourceKind: "github", repositoryVerified: true });
    projectId = String(project?.id);
    await refreshVerifiedProjectMapping(db, {
      workspaceId,
      projectId,
      defaultBranch: repository.default_branch,
      graphJson,
      scanSummary,
      serviceCount: graph.nodes.length,
    });
  }
  const mapped = await db.prepare("SELECT * FROM projects WHERE id = ? AND workspace_id = ?").bind(projectId, workspaceId).first<Record<string, unknown>>();
  if (!mapped) throw new Error("Verified project mapping was not persisted");
  await db.prepare("UPDATE composio_github_repositories SET selected = 1, synced_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?").bind(repositoryRowId, workspaceId).run();
  await createModelVersionForProject(db, workspaceId, mapped, { commitSha: tree.commitSha, graph, confidence: graph.truncated ? 78 : 90 });
  await recordAudit({ workspaceId, actorEmail: email, action: "composio.repository.imported", targetType: "project", targetId: projectId, summary: `Imported and mapped ${repository.full_name} through Composio`, metadata: { connectionId: repository.connection_id, repositoryId: repository.repository_id, commitSha: tree.commitSha, componentCount: graph.nodes.length } });
  return mapped;
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
