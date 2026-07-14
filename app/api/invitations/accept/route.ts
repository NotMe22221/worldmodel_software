import { acceptWorkspaceInvitation, inspectWorkspaceInvitation } from "@/db/team";
import { requestIdentity } from "@/server/request-identity";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Invitation could not be accepted";
  const status = message.includes("limit exceeded") ? 429 : message.includes("available seat") ? 409 : message.includes("another signed-in account") ? 403 : 400;
  return Response.json({ error: message }, { status, headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
}

export async function GET(request: Request) {
  const email = requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) return Response.json({ error: "Invitation token is required" }, { status: 400 });
  try { return Response.json({ invitation: await inspectWorkspaceInvitation(email, token) }, { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const email = requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { token?: string };
  try { payload = await request.json(); }
  catch { return Response.json({ error: "A valid JSON request body is required" }, { status: 400 }); }
  const token = payload.token?.trim();
  if (!token) return Response.json({ error: "Invitation token is required" }, { status: 400 });
  try { return Response.json({ membership: await acceptWorkspaceInvitation(email, token) }, { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } }); }
  catch (error) { return failure(error); }
}
