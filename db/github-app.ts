import type { GithubInstallation, GithubRepository } from "../server/github.ts";
import type { RuntimeDatabase, RuntimeStatement } from "../server/runtime-env.ts";

export type WorkspaceGithubRepository = {
  repository_id: string;
  installation_id: string;
  full_name: string;
  default_branch: string;
};

export function githubConnectionStatements(
  db: RuntimeDatabase,
  workspaceId: string,
  email: string,
  installation: GithubInstallation,
  repositories: GithubRepository[],
): RuntimeStatement[] {
  return [
    db.prepare("INSERT INTO github_workspace_installations (workspace_id, installation_id, account_login, account_type, repository_selection, permissions_json, status, connected_by) VALUES (?, ?, ?, ?, ?, ?, 'active', ?) ON CONFLICT(workspace_id, installation_id) DO UPDATE SET account_login = excluded.account_login, account_type = excluded.account_type, repository_selection = excluded.repository_selection, permissions_json = excluded.permissions_json, status = 'active', connected_by = excluded.connected_by, updated_at = CURRENT_TIMESTAMP").bind(workspaceId, String(installation.id), installation.account.login, installation.account.type, installation.repository_selection, JSON.stringify(installation.permissions), email.toLowerCase()),
    ...repositories.map((repository) => db.prepare("INSERT INTO github_workspace_repositories (workspace_id, repository_id, installation_id, full_name, default_branch, is_private, synced_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(workspace_id, repository_id) DO UPDATE SET installation_id = excluded.installation_id, full_name = excluded.full_name, default_branch = excluded.default_branch, is_private = excluded.is_private, synced_at = CURRENT_TIMESTAMP").bind(workspaceId, String(repository.id), String(installation.id), repository.full_name, repository.default_branch, repository.private ? 1 : 0)),
  ];
}

export async function findActiveGithubRepository(
  db: RuntimeDatabase,
  workspaceId: string,
  repositoryId: string,
) {
  return db.prepare("SELECT gr.repository_id, gr.installation_id, gr.full_name, gr.default_branch FROM github_workspace_repositories gr JOIN github_workspace_installations gi ON gi.workspace_id = gr.workspace_id AND gi.installation_id = gr.installation_id WHERE gr.repository_id = ? AND gr.workspace_id = ? AND gi.status = 'active'").bind(repositoryId, workspaceId).first<WorkspaceGithubRepository>();
}

export async function requireImportableGithubRepository(
  db: RuntimeDatabase,
  workspaceId: string,
  repositoryId: string,
) {
  const repository = await findActiveGithubRepository(db, workspaceId, repositoryId);
  if (!repository) throw new Error("GitHub repository was not found in this workspace");
  return repository;
}

export async function selectGithubRepository(
  db: RuntimeDatabase,
  workspaceId: string,
  repositoryId: string,
) {
  return db.prepare("UPDATE github_workspace_repositories SET selected = 1 WHERE repository_id = ? AND workspace_id = ?").bind(repositoryId, workspaceId).run();
}
