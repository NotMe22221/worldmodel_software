import { getRuntimeEnv } from "../server/runtime-env.ts";

async function getD1() {
  const env = await getRuntimeEnv();
  if (!env.DB) throw new Error("Durable database is unavailable");
  return env.DB;
}

export async function recordAudit(input: { workspaceId: string; actorEmail: string; action: string; targetType: string; targetId?: string | null; summary: string; metadata?: Record<string, string | number | boolean | null> }) {
  const db = await getD1();
  const id = `aud_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  await db.prepare("INSERT INTO audit_logs (id, workspace_id, actor_email, action, target_type, target_id, summary, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, input.workspaceId, input.actorEmail.toLowerCase(), input.action, input.targetType, input.targetId || null, input.summary, JSON.stringify(input.metadata || {})).run();
  return id;
}
