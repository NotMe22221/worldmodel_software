import type { RuntimeDatabase } from "../server/runtime-env.ts";

export type MappedModelVersionInput = {
  modelId: string;
  workspaceId: string;
  projectId: string;
  repository: string;
  branch: string;
  commitSha: string;
  graphJson: string;
  confidence: number;
};

export async function persistMappedModelVersion(db: RuntimeDatabase, input: MappedModelVersionInput) {
  const inserted = await db.prepare(
    "INSERT INTO model_versions (id, workspace_id, project_id, commit_sha, graph_json, confidence) SELECT ?, p.workspace_id, p.id, ?, ?, ? FROM projects p WHERE p.id = ? AND p.workspace_id = ? AND p.source_kind = 'github' AND p.repository_verified = 1 AND p.scanned_at IS NOT NULL AND lower(p.repository) = lower(?) AND p.branch = ? AND p.graph_json = ? AND NOT EXISTS (SELECT 1 FROM model_versions mv WHERE mv.workspace_id = p.workspace_id AND mv.project_id = p.id AND lower(mv.commit_sha) = lower(?) AND mv.graph_json = ? AND mv.confidence = ?)",
  ).bind(
    input.modelId,
    input.commitSha,
    input.graphJson,
    input.confidence,
    input.projectId,
    input.workspaceId,
    input.repository,
    input.branch,
    input.graphJson,
    input.commitSha,
    input.graphJson,
    input.confidence,
  ).run();
  if (Number(inserted.meta.changes || 0) === 1) return db.prepare("SELECT * FROM model_versions WHERE id = ?").bind(input.modelId).first<Record<string, unknown>>();

  const existing = await db.prepare(
    "SELECT mv.* FROM model_versions mv JOIN projects p ON p.id = mv.project_id AND p.workspace_id = mv.workspace_id WHERE mv.workspace_id = ? AND mv.project_id = ? AND lower(mv.commit_sha) = lower(?) AND mv.graph_json = ? AND mv.confidence = ? AND p.source_kind = 'github' AND p.repository_verified = 1 AND p.scanned_at IS NOT NULL AND lower(p.repository) = lower(?) AND p.branch = ? AND p.graph_json = ? ORDER BY mv.created_at ASC, mv.id ASC LIMIT 1",
  ).bind(
    input.workspaceId,
    input.projectId,
    input.commitSha,
    input.graphJson,
    input.confidence,
    input.repository,
    input.branch,
    input.graphJson,
  ).first<Record<string, unknown>>();
  if (existing) return existing;
  throw new Error("model_conflict: Repository mapping changed while this model was being imported; retry the import");
}
