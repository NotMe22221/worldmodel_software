import { recordAudit } from "./audit";
import { getSaasSnapshot, requireRole, requireWriteEntitlement } from "./saas";
import { repairTransition } from "../worldmodel/repair-workflow.mjs";
import { getRuntimeEnv } from "@/server/runtime-env";
import {
  githubDraftBody,
  githubEvidencePath,
  githubRepositoryParts,
} from "../worldmodel/github-pr-contract.mjs";
import { publishGithubDraftEvidence } from "../server/github";

type RepairStatus =
  | "ready_for_review"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "pr_ready";

async function getD1() {
  const env = await getRuntimeEnv();
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

function findRepair(
  snapshot: Awaited<ReturnType<typeof getSaasSnapshot>>,
  proposalId: string,
) {
  const repair = snapshot.repairs.find(
    (candidate) => String(candidate.id) === proposalId,
  );
  if (!repair) throw new Error("Repair proposal not found");
  return repair as Record<string, unknown>;
}

export async function requestRepairReview(
  email: string,
  proposalId: string,
  reviewerEmail?: string,
) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin", "member"]);
  requireWriteEntitlement(snapshot.entitlements);
  const repair = findRepair(snapshot, proposalId);
  try {
    repairTransition(String(repair.status), "request-review");
  } catch {
    throw new Error("This repair is not ready to enter review");
  }
  let reviewer: string | null = null;
  if (reviewerEmail) {
    const member = snapshot.members.find(
      (candidate) =>
        String(candidate.email).toLowerCase() === reviewerEmail.toLowerCase(),
    );
    if (!member || !["owner", "admin"].includes(String(member.role)))
      throw new Error(
        "The assigned reviewer must be a workspace owner or administrator",
      );
    reviewer = reviewerEmail.toLowerCase();
  }
  const db = await getD1();
  await db
    .prepare(
      "UPDATE repair_proposals SET status = 'in_review', reviewer_email = ?, decision_note = NULL, requested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?",
    )
    .bind(reviewer, proposalId, snapshot.workspace.id)
    .run();
  await recordAudit({
    workspaceId: String(snapshot.workspace.id),
    actorEmail: email,
    action: "repair.review_requested",
    targetType: "repair_proposal",
    targetId: proposalId,
    summary: `Submitted ${repair.title} for review`,
    metadata: { reviewer },
  });
  return getRepairPacket(email, proposalId);
}

async function decideRepair(
  email: string,
  proposalId: string,
  decision: "approved" | "changes_requested",
  note: string,
) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  requireWriteEntitlement(snapshot.entitlements);
  const repair = findRepair(snapshot, proposalId);
  try {
    repairTransition(
      String(repair.status),
      decision === "approved" ? "approve" : "request-changes",
    );
  } catch {
    throw new Error("This repair is not awaiting a review decision");
  }
  if (
    repair.reviewer_email &&
    String(repair.reviewer_email).toLowerCase() !== email.toLowerCase()
  )
    throw new Error("This repair is assigned to another reviewer");
  if (note.trim().length < 10 || note.trim().length > 1000)
    throw new Error("A review note between 10 and 1000 characters is required");
  const db = await getD1();
  await db
    .prepare(
      "UPDATE repair_proposals SET status = ?, decision_note = ?, approved_by = CASE WHEN ? = 'approved' THEN ? ELSE NULL END, approved_at = CASE WHEN ? = 'approved' THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?",
    )
    .bind(
      decision,
      note.trim(),
      decision,
      email.toLowerCase(),
      decision,
      proposalId,
      snapshot.workspace.id,
    )
    .run();
  await recordAudit({
    workspaceId: String(snapshot.workspace.id),
    actorEmail: email,
    action:
      decision === "approved" ? "repair.approved" : "repair.changes_requested",
    targetType: "repair_proposal",
    targetId: proposalId,
    summary:
      decision === "approved"
        ? `Approved ${repair.title}`
        : `Requested changes to ${repair.title}`,
    metadata: { note: note.trim() },
  });
  return getRepairPacket(email, proposalId);
}

export function approveRepair(email: string, proposalId: string, note: string) {
  return decideRepair(email, proposalId, "approved", note);
}

export function requestRepairChanges(
  email: string,
  proposalId: string,
  note: string,
) {
  return decideRepair(email, proposalId, "changes_requested", note);
}

export async function prepareRepairPullRequest(
  email: string,
  proposalId: string,
) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  requireWriteEntitlement(snapshot.entitlements);
  if (String(snapshot.workspace.workspace_mode) === "sample")
    throw new Error(
      "Sample repair candidates cannot be published. Create a clean customer workspace and rerun the scenario against a connected repository",
    );
  const repair = findRepair(snapshot, proposalId);
  if (!repair.repository_verified)
    throw new Error(
      "Repository ownership is unverified. Import this repository through the workspace GitHub installation before preparing a pull request",
    );
  try {
    repairTransition(String(repair.status), "prepare-pr");
  } catch {
    throw new Error(
      "The repair must be approved before a pull request can be prepared",
    );
  }
  const db = await getD1();
  const repository = await db
    .prepare(
      "SELECT gr.repository_id, gr.installation_id, gi.permissions_json FROM github_repositories gr JOIN github_installations gi ON gi.installation_id = gr.installation_id WHERE gr.workspace_id = ? AND lower(gr.full_name) = lower(?) AND gi.status = 'active' LIMIT 1",
    )
    .bind(snapshot.workspace.id, repair.repository)
    .first<{
      repository_id: string;
      installation_id: string;
      permissions_json: string;
    }>();
  const branchName = `worldmodel/${String(repair.run_id)
    .replace(/^run_/, "repair-")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 70)}`;
  let prStatus = "connection_required";
  if (repository) {
    const permissions = JSON.parse(
      repository.permissions_json || "{}",
    ) as Record<string, string>;
    prStatus =
      permissions.contents === "write" && permissions.pull_requests === "write"
        ? "ready_to_publish"
        : "permission_required";
  }
  await db
    .prepare(
      "UPDATE repair_proposals SET status = 'pr_ready', pr_status = ?, branch_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?",
    )
    .bind(prStatus, branchName, proposalId, snapshot.workspace.id)
    .run();
  await recordAudit({
    workspaceId: String(snapshot.workspace.id),
    actorEmail: email,
    action: "repair.pr_prepared",
    targetType: "repair_proposal",
    targetId: proposalId,
    summary: `Prepared draft pull request handoff for ${repair.title}`,
    metadata: { branchName, prStatus },
  });
  return getRepairPacket(email, proposalId);
}

export async function publishRepairPullRequest(
  email: string,
  proposalId: string,
) {
  const snapshot = await getSaasSnapshot(email);
  requireRole(snapshot, ["owner", "admin"]);
  requireWriteEntitlement(snapshot.entitlements);
  if (String(snapshot.workspace.workspace_mode) === "sample")
    throw new Error(
      "Sample repair candidates cannot be published. Create a clean customer workspace and rerun the scenario against a connected repository",
    );
  const repair = findRepair(snapshot, proposalId);
  if (!repair.repository_verified)
    throw new Error(
      "Repository ownership is unverified. Import this repository through the workspace GitHub installation before publishing a pull request",
    );
  if (String(repair.status) !== "pr_ready")
    throw new Error("The draft pull request handoff has not been prepared");
  if (String(repair.pr_status) === "published" && repair.pr_url)
    return getRepairPacket(email, proposalId);
  if (
    !["ready_to_publish", "publication_failed"].includes(
      String(repair.pr_status),
    )
  )
    throw new Error(
      "The connected GitHub repository is not ready for draft pull request publication",
    );
  const db = await getD1();
  const repository = await db
    .prepare(
      "SELECT gr.installation_id, gi.permissions_json FROM github_repositories gr JOIN github_installations gi ON gi.installation_id = gr.installation_id WHERE gr.workspace_id = ? AND lower(gr.full_name) = lower(?) AND gi.status = 'active' LIMIT 1",
    )
    .bind(snapshot.workspace.id, repair.repository)
    .first<{ installation_id: string; permissions_json: string }>();
  if (!repository)
    throw new Error(
      "The connected GitHub repository is not ready for draft pull request publication",
    );
  const permissions = JSON.parse(repository.permissions_json || "{}") as Record<
    string,
    string
  >;
  if (permissions.contents !== "write" || permissions.pull_requests !== "write")
    throw new Error(
      "The GitHub App requires Contents and Pull requests write permissions",
    );
  const claimed = await db
    .prepare(
      "UPDATE repair_proposals SET pr_status = 'publishing', pr_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ? AND pr_status IN ('ready_to_publish', 'publication_failed')",
    )
    .bind(proposalId, snapshot.workspace.id)
    .run();
  if (!claimed.meta.changes)
    throw new Error("Draft pull request publication is already in progress");
  try {
    const packet = await getRepairPacket(email, proposalId);
    const parts = githubRepositoryParts(String(repair.repository));
    const published = await publishGithubDraftEvidence({
      installationId: repository.installation_id,
      owner: parts.owner,
      repository: parts.repository,
      baseBranch: String(repair.project_branch),
      headBranch: String(repair.branch_name),
      evidencePath: githubEvidencePath(proposalId),
      title: `draft: ${repair.title}`,
      body: githubDraftBody(packet),
      evidence: JSON.stringify(packet, null, 2),
    });
    await db
      .prepare(
        "UPDATE repair_proposals SET pr_status = 'published', pr_url = ?, pr_number = ?, pr_error = NULL, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?",
      )
      .bind(
        published.html_url,
        published.number,
        proposalId,
        snapshot.workspace.id,
      )
      .run();
    await recordAudit({
      workspaceId: String(snapshot.workspace.id),
      actorEmail: email,
      action: "repair.pr_published",
      targetType: "repair_proposal",
      targetId: proposalId,
      summary: `Published draft pull request #${published.number} for ${repair.title}`,
      metadata: {
        repository: String(repair.repository || ""),
        branch: String(repair.branch_name || ""),
        pullRequestNumber: published.number,
        url: published.html_url,
      },
    });
    return getRepairPacket(email, proposalId);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 300)
        : "GitHub publication failed";
    await db
      .prepare(
        "UPDATE repair_proposals SET pr_status = 'publication_failed', pr_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?",
      )
      .bind(message, proposalId, snapshot.workspace.id)
      .run();
    throw error;
  }
}

export async function getRepairPacket(email: string, proposalId: string) {
  const snapshot = await getSaasSnapshot(email);
  const repair = findRepair(snapshot, proposalId);
  return {
    id: repair.id,
    workspace: { id: snapshot.workspace.id, name: snapshot.workspace.name },
    project: {
      name: repair.project_name,
      repository: repair.repository,
      baseBranch: repair.project_branch,
      repositoryVerified: Boolean(repair.repository_verified),
    },
    scenario: {
      runId: repair.run_id,
      name: repair.scenario,
      fingerprint: repair.scenario_fingerprint,
      evidenceKind: repair.evidence_kind,
      environmentId: repair.environment_id,
      journeyRunner: repair.journey_runner,
      environmentDestroyedAt: repair.environment_destroyed_at,
      beforeServiceHealth: repair.before_service_health,
      afterServiceHealth: repair.after_service_health,
      verifiedAt: repair.verified_at,
      beforeScore: repair.before_score,
      afterScore: repair.after_score,
    },
    repair: {
      title: repair.title,
      summary: repair.summary,
      files: JSON.parse(String(repair.files_json)),
      tests: JSON.parse(String(repair.tests_json)),
      residualRisks: JSON.parse(String(repair.risks_json)),
    },
    review: {
      status: repair.status as RepairStatus,
      requestedAt: repair.requested_at,
      reviewer: repair.reviewer_email,
      decisionNote: repair.decision_note,
      approvedBy: repair.approved_by,
      approvedAt: repair.approved_at,
    },
    pullRequest: {
      status: repair.pr_status,
      branch: repair.branch_name,
      url: repair.pr_url,
      number: repair.pr_number,
      error: repair.pr_error,
      publishedAt: repair.published_at,
    },
    generatedAt: new Date().toISOString(),
  };
}
