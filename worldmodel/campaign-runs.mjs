export const campaignReplayRowsSql = "SELECT cr.*, sr.scenario, sr.error_rate, sr.latency_ms, sr.journey_success FROM campaign_runs cr JOIN campaigns c ON c.id = cr.campaign_id LEFT JOIN simulation_runs sr ON sr.id = cr.simulation_run_id AND sr.project_id = cr.project_id AND sr.status = 'verified' AND sr.evidence_kind = 'observed' WHERE cr.workspace_id = ? AND cr.project_id = ? ORDER BY cr.created_at DESC LIMIT 200";

export async function requestCampaignCancellation(db, campaignId, workspaceId, projectId, requestedAt) {
  const [, claimed] = await db.batch([
    db.prepare("UPDATE campaign_runs SET status = 'cancellation_requested', updated_at = CURRENT_TIMESTAMP WHERE campaign_id = ? AND workspace_id = ? AND project_id = ? AND status IN ('queued','running') AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_runs.campaign_id AND c.workspace_id = campaign_runs.workspace_id AND c.project_id = campaign_runs.project_id AND c.status IN ('dispatching','queued','running'))").bind(campaignId, workspaceId, projectId),
    db.prepare("UPDATE campaigns SET status = 'cancellation_requested', cancellation_requested_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ? AND project_id = ? AND status IN ('dispatching','queued','running')").bind(requestedAt, campaignId, workspaceId, projectId),
  ]);
  return Number(claimed?.meta?.changes || 0) === 1;
}
