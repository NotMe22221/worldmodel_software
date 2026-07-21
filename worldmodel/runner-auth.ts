import { getComposioGithubFileAtCommit } from "../server/composio.ts";
import { githubRepositoryFileAtCommit } from "../server/github.ts";
import type { RuntimeDatabase } from "../server/runtime-env.ts";
import { generateRunnerWorkflow } from "./runner-workflow.mjs";

export type RunnerWorkflowVerificationInput = {
  db: RuntimeDatabase;
  workspaceId: string;
  projectId: string;
  repository: string;
  workflowSha: string;
  apiOrigin: string;
};

export type RunnerWorkflowVerifier = (
  input: RunnerWorkflowVerificationInput,
) => Promise<boolean>;

const workflowShaPattern = /^[a-f0-9]{40}$/i;
const workflowVerificationTtlMs = 5 * 60_000;
const maximumVerificationCacheEntries = 512;
const verifiedWorkflowRevisions = new Map<string, number>();

function workflowPath(projectId: string) {
  return `.github/workflows/worldmodel-${projectId}.yml`;
}

function normalizedWorkflow(value: string) {
  return value.replaceAll("\r\n", "\n");
}

function verificationCacheKey(input: RunnerWorkflowVerificationInput) {
  return [
    input.workspaceId,
    input.projectId,
    input.repository.toLowerCase(),
    input.workflowSha.toLowerCase(),
    input.apiOrigin,
  ].join("\n");
}

function pruneVerificationCache(now: number) {
  for (const [key, expiresAt] of verifiedWorkflowRevisions) {
    if (expiresAt <= now) verifiedWorkflowRevisions.delete(key);
  }
  while (verifiedWorkflowRevisions.size >= maximumVerificationCacheEntries) {
    const oldest = verifiedWorkflowRevisions.keys().next().value as string | undefined;
    if (!oldest) break;
    verifiedWorkflowRevisions.delete(oldest);
  }
}

function workflowMismatch(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /GitHub request failed with status 404/.test(message)
    || /Composio GitHub proxy failed with status 404/.test(message)
    || /^GitHub workflow file (?:is invalid|size is invalid|encoding is invalid)$/.test(message);
}

export const verifyRunnerWorkflowRevision: RunnerWorkflowVerifier = async (input) => {
  if (!workflowShaPattern.test(input.workflowSha)) return false;
  const expected = normalizedWorkflow(generateRunnerWorkflow({ projectId: input.projectId, apiOrigin: input.apiOrigin }));
  const path = workflowPath(input.projectId);
  const [githubApp, composio] = await Promise.all([
    input.db.prepare(`
      SELECT gr.installation_id
      FROM github_workspace_repositories gr
      JOIN github_workspace_installations gi
        ON gi.workspace_id = gr.workspace_id AND gi.installation_id = gr.installation_id
      WHERE gr.workspace_id = ? AND lower(gr.full_name) = lower(?) AND gi.status = 'active'
      LIMIT 1
    `).bind(input.workspaceId, input.repository).first<{ installation_id: string }>(),
    input.db.prepare(`
      SELECT c.connected_account_id
      FROM composio_github_repositories r
      JOIN composio_connections c
        ON c.id = r.connection_id AND c.workspace_id = r.workspace_id
      WHERE r.workspace_id = ? AND lower(r.full_name) = lower(?) AND c.status = 'active'
      LIMIT 1
    `).bind(input.workspaceId, input.repository).first<{ connected_account_id: string }>(),
  ]);

  const failures: unknown[] = [];
  if (githubApp?.installation_id) {
    try {
      const actual = await githubRepositoryFileAtCommit(githubApp.installation_id, input.repository, path, input.workflowSha);
      return normalizedWorkflow(actual) === expected;
    } catch (error) {
      if (workflowMismatch(error)) return false;
      failures.push(error);
    }
  }
  if (composio?.connected_account_id) {
    try {
      const actual = await getComposioGithubFileAtCommit(composio.connected_account_id, input.repository, path, input.workflowSha);
      return normalizedWorkflow(actual) === expected;
    } catch (error) {
      if (workflowMismatch(error)) return false;
      failures.push(error);
    }
  }
  if (!githubApp?.installation_id && !composio?.connected_account_id) throw new Error("No active workspace-scoped GitHub connection can verify the runner workflow");
  throw failures[failures.length - 1] || new Error("Runner workflow verification provider is unavailable");
};

export async function requireVerifiedRunnerWorkflowRevision(
  input: RunnerWorkflowVerificationInput,
  verifier: RunnerWorkflowVerifier = verifyRunnerWorkflowRevision,
) {
  const now = Date.now();
  const key = verificationCacheKey(input);
  if ((verifiedWorkflowRevisions.get(key) || 0) > now) return;
  let matches = false;
  try {
    matches = await verifier(input);
  } catch {
    throw new Error("runner_verification_unavailable: The signed GitHub workflow revision could not be verified; retry when the repository provider is available");
  }
  if (!matches) throw new Error("oidc_unauthorized: The signed GitHub workflow revision does not match the generated WorldModel runner");
  pruneVerificationCache(now);
  verifiedWorkflowRevisions.set(key, now + workflowVerificationTtlMs);
}
