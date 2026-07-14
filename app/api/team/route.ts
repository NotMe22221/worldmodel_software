import { createWorkspaceInvitation, removeWorkspaceMember, revokeWorkspaceInvitation, updateWorkspaceMemberRole } from "@/db/team";
import { requestIdentity } from "@/server/request-identity";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Team change could not be completed";
  const status = message.includes("role") || message.includes("Only the workspace owner") || message.includes("owner cannot") ? 403 : message.includes("plan") ? 402 : message.includes("already") ? 409 : message.includes("not found") ? 404 : 400;
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const email = requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { action?: string; email?: string; role?: string; invitationId?: string };
  try { payload = await request.json(); }
  catch { return Response.json({ error: "A valid JSON request body is required" }, { status: 400 }); }
  const roles = ["admin", "member", "viewer"] as const;
  if (payload.action === "invite") {
    const invitee = payload.email?.trim().toLowerCase();
    const role = roles.includes(payload.role as typeof roles[number]) ? payload.role as typeof roles[number] : "member";
    if (!invitee || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitee)) return Response.json({ error: "A valid email address is required" }, { status: 400 });
    try { return Response.json(await createWorkspaceInvitation(email, invitee, role), { status: 201 }); }
    catch (error) { return failure(error); }
  }
  if (payload.action === "revoke-invitation") {
    if (!payload.invitationId || payload.invitationId.length > 80) return Response.json({ error: "A valid invitation is required" }, { status: 400 });
    try { return Response.json({ invitation: await revokeWorkspaceInvitation(email, payload.invitationId) }); }
    catch (error) { return failure(error); }
  }
  if (payload.action === "update-role") {
    const memberEmail = payload.email?.trim().toLowerCase();
    if (!memberEmail || !roles.includes(payload.role as typeof roles[number])) return Response.json({ error: "A valid member and role are required" }, { status: 400 });
    try { return Response.json({ member: await updateWorkspaceMemberRole(email, memberEmail, payload.role as typeof roles[number]) }); }
    catch (error) { return failure(error); }
  }
  if (payload.action === "remove-member") {
    const memberEmail = payload.email?.trim().toLowerCase();
    if (!memberEmail) return Response.json({ error: "A valid member is required" }, { status: 400 });
    try { return Response.json({ member: await removeWorkspaceMember(email, memberEmail) }); }
    catch (error) { return failure(error); }
  }
  return Response.json({ error: "Choose a supported team action" }, { status: 400 });
}
