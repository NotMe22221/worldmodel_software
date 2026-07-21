import { acceptWorkspaceInvitation, inspectWorkspaceInvitation } from "@/db/team";
import { readBoundedRequestJson, RequestBodyTooLargeError } from "@/server/bounded-request-body";
import { requestIdentity } from "@/server/request-identity";

const MAX_INVITATION_BODY_BYTES = 2_048;

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Invitation could not be accepted";
  const status = message.includes("limit exceeded") ? 429 : message.includes("available seat") ? 409 : message.includes("another signed-in account") ? 403 : 400;
  return Response.json({ error: message }, { status, headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
}

export async function GET(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) return Response.json({ error: "Invitation token is required" }, { status: 400 });
  try { return Response.json({ invitation: await inspectWorkspaceInvitation(email, token) }, { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { token?: string };
  try { payload = await readBoundedRequestJson(request, MAX_INVITATION_BODY_BYTES); }
  catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError;
    return Response.json({ error: tooLarge ? "Request body exceeds 2 KB" : "A valid JSON request body is required" }, { status: tooLarge ? 413 : 400 });
  }
  const token = payload.token?.trim();
  if (!token) return Response.json({ error: "Invitation token is required" }, { status: 400 });
  try { return Response.json({ membership: await acceptWorkspaceInvitation(email, token) }, { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } }); }
  catch (error) { return failure(error); }
}
