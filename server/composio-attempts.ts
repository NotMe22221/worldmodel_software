import type { RuntimeDatabase } from "./runtime-env.ts";

export type PendingConnectionAttempt = {
  state_hash: string;
  workspace_id: string;
  created_by: string;
  composio_user_id: string;
  connected_account_id: string | null;
  auth_config_id: string;
  expires_at: string;
  used_at: string | null;
};

const ATTEMPT_CLAIM_PREFIX = "processing:";

function changes(result: unknown) {
  const meta = result && typeof result === "object" ? (result as { meta?: { changes?: unknown } }).meta : undefined;
  return Number(meta?.changes || 0);
}

export async function cleanupComposioConnectionAttempts(db: RuntimeDatabase, now: string) {
  await db.prepare("DELETE FROM composio_connection_attempts WHERE expires_at <= ? OR (used_at IS NOT NULL AND used_at NOT LIKE ?)").bind(now, `${ATTEMPT_CLAIM_PREFIX}%`).run();
}

export async function getComposioConnectionAttempt(db: RuntimeDatabase, stateHash: string) {
  return db.prepare("SELECT state_hash, workspace_id, created_by, composio_user_id, connected_account_id, auth_config_id, expires_at, used_at FROM composio_connection_attempts WHERE state_hash = ?").bind(stateHash).first<PendingConnectionAttempt>();
}

export async function claimComposioConnectionAttempt(db: RuntimeDatabase, stateHash: string, now: string, correlationId: string) {
  const claim = `${ATTEMPT_CLAIM_PREFIX}${now}:${correlationId}`;
  const result = await db.prepare("UPDATE composio_connection_attempts SET used_at = ? WHERE state_hash = ? AND used_at IS NULL AND expires_at > ?").bind(claim, stateHash, now).run();
  return changes(result) ? claim : null;
}

export async function releaseComposioConnectionAttempt(db: RuntimeDatabase, stateHash: string, claim: string, now: string) {
  const result = await db.prepare("UPDATE composio_connection_attempts SET used_at = NULL WHERE state_hash = ? AND used_at = ? AND expires_at > ?").bind(stateHash, claim, now).run();
  return changes(result) > 0;
}

export async function finalizeComposioConnectionAttempt(db: RuntimeDatabase, stateHash: string, claim: string) {
  const result = await db.prepare("UPDATE composio_connection_attempts SET used_at = CURRENT_TIMESTAMP WHERE state_hash = ? AND used_at = ?").bind(stateHash, claim).run();
  return changes(result) > 0;
}

export async function newestRecoverableComposioConnectionAttempt(db: RuntimeDatabase, input: { workspaceId: string; email: string; composioUserId: string; authConfigId: string; now: string }) {
  return db.prepare("SELECT state_hash, workspace_id, created_by, composio_user_id, connected_account_id, auth_config_id, expires_at, used_at FROM composio_connection_attempts WHERE workspace_id=? AND lower(created_by)=lower(?) AND composio_user_id=? AND auth_config_id=? AND used_at IS NULL AND connected_account_id IS NOT NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1").bind(input.workspaceId, input.email, input.composioUserId, input.authConfigId, input.now).first<PendingConnectionAttempt>();
}
