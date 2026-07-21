import { recordAudit } from "./audit.ts";
import { ensureSaasSchema, getSaasSnapshot, getWorkspaceEntitlements, requireRole, requireWriteEntitlement } from "./saas.ts";
import { digestInvitationSecret, generateInvitationSecret } from "../worldmodel/invitation-security.mjs";
import { getRuntimeEnv } from "../server/runtime-env.ts";

type TeamRole = "admin" | "member" | "viewer";

export const createInvitationWithinSeatLimitSql = "INSERT INTO workspace_invitations (id, workspace_id, email, role, token_hash, invited_by, expires_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND lower(email) = lower(?)) AND ((SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ?) + (SELECT COUNT(*) FROM workspace_invitations WHERE workspace_id = ? AND status = 'pending' AND datetime(expires_at) > CURRENT_TIMESTAMP)) < ?";
export const acceptInvitationWithinSeatLimitSql = "INSERT INTO workspace_members (workspace_id, email, role) SELECT i.workspace_id, lower(i.email), i.role FROM workspace_invitations i WHERE i.id = ? AND i.workspace_id = ? AND lower(i.email) = lower(?) AND i.status = 'pending' AND datetime(i.expires_at) > CURRENT_TIMESTAMP AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND lower(email) = lower(?)) AND (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ?) < ? ON CONFLICT(workspace_id, email) DO NOTHING";

async function getD1() {
  const env = await getRuntimeEnv();
  if (!env.DB) throw new Error("Durable database is unavailable");
  return env.DB;
}

function actorRole(snapshot: Awaited<ReturnType<typeof getSaasSnapshot>>) {
  return String((snapshot.workspace as Record<string, unknown>).membership_role || "viewer");
}

export async function createWorkspaceInvitation(actorEmail: string, inviteeEmail: string, role: TeamRole) {
  const snapshot = await getSaasSnapshot(actorEmail);
  requireRole(snapshot, ["owner", "admin"]);
  requireWriteEntitlement(snapshot.entitlements);
  const actor = actorRole(snapshot);
  if (actor !== "owner" && role === "admin") throw new Error("Only the workspace owner can invite an administrator");
  const db = await getD1();
  const workspaceId = String(snapshot.workspace.id);
  const normalizedInvitee = inviteeEmail.toLowerCase();
  const id = `inv_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
  const token = generateInvitationSecret(id);
  const tokenHash = await digestInvitationSecret(token);
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const [, inserted] = await db.batch([
    db.prepare("UPDATE workspace_invitations SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND lower(email) = lower(?) AND status = 'pending'").bind(workspaceId, normalizedInvitee),
    db.prepare(createInvitationWithinSeatLimitSql).bind(id, workspaceId, normalizedInvitee, role, tokenHash, actorEmail.toLowerCase(), expiresAt, workspaceId, normalizedInvitee, workspaceId, workspaceId, snapshot.entitlements.limits.seats),
  ]);
  if (Number(inserted?.meta.changes || 0) !== 1) {
    const member = await db.prepare("SELECT 1 AS found FROM workspace_members WHERE workspace_id = ? AND lower(email) = lower(?)").bind(workspaceId, normalizedInvitee).first();
    if (member) throw new Error("This person is already a workspace member");
    throw new Error(`${snapshot.entitlements.planName} plan seat limit reached`);
  }
  await recordAudit({ workspaceId, actorEmail, action: "invitation.created", targetType: "workspace_invitation", targetId: id, summary: `Invited ${inviteeEmail} as ${role}`, metadata: { role, expiresAt } });
  const invitation = await db.prepare("SELECT id, email, role, status, invited_by, expires_at, created_at FROM workspace_invitations WHERE id = ?").bind(id).first();
  return { invitation, token };
}

export async function revokeWorkspaceInvitation(actorEmail: string, invitationId: string) {
  const snapshot = await getSaasSnapshot(actorEmail);
  requireRole(snapshot, ["owner", "admin"]);
  const db = await getD1();
  const invitation = await db.prepare("SELECT id, role FROM workspace_invitations WHERE id = ? AND workspace_id = ? AND status = 'pending'").bind(invitationId, snapshot.workspace.id).first<{ id: string; role: string }>();
  if (!invitation) throw new Error("Pending invitation not found");
  if (actorRole(snapshot) !== "owner" && invitation.role === "admin") throw new Error("Only the workspace owner can revoke an administrator invitation");
  await db.prepare("UPDATE workspace_invitations SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(invitationId).run();
  await recordAudit({ workspaceId: String(snapshot.workspace.id), actorEmail, action: "invitation.revoked", targetType: "workspace_invitation", targetId: invitationId, summary: "Revoked a workspace invitation" });
  return { id: invitationId, status: "revoked" };
}

async function checkInvitationRate(email: string) {
  const db = await getD1();
  const subjectHash = await digestInvitationSecret(`identity:${email.toLowerCase()}`);
  const bucketStart = `${new Date().toISOString().slice(0, 16)}:00Z`;
  const id = `${subjectHash}:${bucketStart}`;
  await db.prepare("INSERT INTO invitation_rate_buckets (id, subject_hash, bucket_start, request_count) VALUES (?, ?, ?, 1) ON CONFLICT(subject_hash, bucket_start) DO UPDATE SET request_count = request_count + 1").bind(id, subjectHash, bucketStart).run();
  const bucket = await db.prepare("SELECT request_count FROM invitation_rate_buckets WHERE subject_hash = ? AND bucket_start = ?").bind(subjectHash, bucketStart).first<{ request_count: number }>();
  const count = Number(bucket?.request_count || 1);
  if (count === 1) await db.prepare("DELETE FROM invitation_rate_buckets WHERE bucket_start < datetime('now', '-2 days')").run();
  if (count > 10) throw new Error("Invitation attempt limit exceeded");
}

async function findInvitation(email: string, token: string) {
  if (!token.startsWith("wmi_inv_") || token.length > 160) throw new Error("Invitation is invalid, expired, or belongs to another signed-in account");
  await ensureSaasSchema();
  await checkInvitationRate(email);
  const db = await getD1();
  const tokenHash = await digestInvitationSecret(token);
  const invitation = await db.prepare("SELECT i.id, i.workspace_id, i.email, i.role, i.expires_at, w.name AS workspace_name FROM workspace_invitations i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token_hash = ? AND i.status = 'pending' AND datetime(i.expires_at) > CURRENT_TIMESTAMP").bind(tokenHash).first<{ id: string; workspace_id: string; email: string; role: TeamRole; expires_at: string; workspace_name: string }>();
  if (!invitation || invitation.email.toLowerCase() !== email.toLowerCase()) throw new Error("Invitation is invalid, expired, or belongs to another signed-in account");
  return invitation;
}

export async function inspectWorkspaceInvitation(email: string, token: string) {
  const invitation = await findInvitation(email, token);
  return { workspaceName: invitation.workspace_name, role: invitation.role, expiresAt: invitation.expires_at };
}

export async function acceptWorkspaceInvitation(email: string, token: string) {
  const invitation = await findInvitation(email, token);
  const db = await getD1();
  const normalizedEmail = email.toLowerCase();
  const entitlements = await getWorkspaceEntitlements(invitation.workspace_id);
  const [, claimed] = await db.batch([
    db.prepare(acceptInvitationWithinSeatLimitSql).bind(invitation.id, invitation.workspace_id, normalizedEmail, invitation.workspace_id, normalizedEmail, invitation.workspace_id, entitlements.limits.seats),
    db.prepare("UPDATE workspace_invitations SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ? AND lower(email) = lower(?) AND status = 'pending' AND datetime(expires_at) > CURRENT_TIMESTAMP AND EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND lower(email) = lower(?))").bind(invitation.id, invitation.workspace_id, normalizedEmail, invitation.workspace_id, normalizedEmail),
  ]);
  if (Number(claimed?.meta.changes || 0) !== 1) {
    const stillPending = await db.prepare("SELECT 1 AS found FROM workspace_invitations WHERE id = ? AND workspace_id = ? AND status = 'pending' AND datetime(expires_at) > CURRENT_TIMESTAMP").bind(invitation.id, invitation.workspace_id).first();
    if (stillPending) throw new Error("The workspace no longer has an available seat");
    throw new Error("Invitation is invalid, expired, or already used");
  }
  const membership = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND lower(email) = lower(?)").bind(invitation.workspace_id, normalizedEmail).first<{ role: string }>();
  if (!membership) throw new Error("The workspace no longer has an available seat");
  await db.prepare("INSERT INTO user_preferences (email, active_workspace_id) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET active_workspace_id = excluded.active_workspace_id, updated_at = CURRENT_TIMESTAMP").bind(email.toLowerCase(), invitation.workspace_id).run();
  await recordAudit({ workspaceId: invitation.workspace_id, actorEmail: email, action: "invitation.accepted", targetType: "workspace_invitation", targetId: invitation.id, summary: `${email} joined the workspace`, metadata: { role: membership.role } });
  return { workspaceId: invitation.workspace_id, workspaceName: invitation.workspace_name, role: membership.role };
}

export async function updateWorkspaceMemberRole(actorEmail: string, memberEmail: string, role: TeamRole) {
  const snapshot = await getSaasSnapshot(actorEmail);
  requireRole(snapshot, ["owner", "admin"]);
  const actor = actorRole(snapshot);
  const target = snapshot.members.find((member) => String(member.email).toLowerCase() === memberEmail.toLowerCase());
  if (!target) throw new Error("Workspace member not found");
  if (target.role === "owner") throw new Error("The workspace owner role cannot be changed");
  if (actor !== "owner" && (target.role === "admin" || role === "admin")) throw new Error("Only the workspace owner can manage administrators");
  const db = await getD1();
  await db.prepare("UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND lower(email) = lower(?)").bind(role, snapshot.workspace.id, memberEmail).run();
  await recordAudit({ workspaceId: String(snapshot.workspace.id), actorEmail, action: "member.role_updated", targetType: "member", targetId: memberEmail, summary: `Changed ${memberEmail} to ${role}`, metadata: { previousRole: String(target.role), role } });
  return { email: memberEmail, role };
}

export async function removeWorkspaceMember(actorEmail: string, memberEmail: string) {
  const snapshot = await getSaasSnapshot(actorEmail);
  requireRole(snapshot, ["owner", "admin"]);
  const actor = actorRole(snapshot);
  const target = snapshot.members.find((member) => String(member.email).toLowerCase() === memberEmail.toLowerCase());
  if (!target) throw new Error("Workspace member not found");
  if (target.role === "owner") throw new Error("The workspace owner cannot be removed");
  if (actor !== "owner" && target.role === "admin") throw new Error("Only the workspace owner can remove an administrator");
  const db = await getD1();
  await db.prepare("DELETE FROM workspace_members WHERE workspace_id = ? AND lower(email) = lower(?)").bind(snapshot.workspace.id, memberEmail).run();
  await db.prepare("DELETE FROM user_preferences WHERE lower(email) = lower(?) AND active_workspace_id = ?").bind(memberEmail, snapshot.workspace.id).run();
  await recordAudit({ workspaceId: String(snapshot.workspace.id), actorEmail, action: "member.removed", targetType: "member", targetId: memberEmail, summary: `Removed ${memberEmail} from the workspace`, metadata: { previousRole: String(target.role) } });
  return { email: memberEmail, removed: true };
}
