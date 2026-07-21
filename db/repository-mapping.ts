import type { RuntimeDatabase } from "@/server/runtime-env";

export async function refreshVerifiedProjectMapping(
  db: RuntimeDatabase,
  input: {
    workspaceId: string;
    projectId: string;
    defaultBranch: string;
    graphJson: string;
    scanSummary: string;
    serviceCount: number;
  },
) {
  await db
    .prepare(
      "UPDATE projects SET branch = ?, source_kind = 'github', repository_verified = 1, graph_json = ?, scan_summary = ?, scanned_at = CURRENT_TIMESTAMP, service_count = ?, status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?",
    )
    .bind(
      input.defaultBranch,
      input.graphJson,
      input.scanSummary,
      input.serviceCount,
      input.projectId,
      input.workspaceId,
    )
    .run();
}
