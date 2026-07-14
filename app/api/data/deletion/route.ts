import { cancelWorkspaceDeletion, requestWorkspaceDeletion } from "@/db/operations";
import { requestIdentity } from "@/server/request-identity";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Deletion request could not be updated";
  const status = message.includes("role") ? 403 : message.includes("already pending") ? 409 : message.includes("not found") ? 404 : 500;
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const email = requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { action?: string; reason?: string; requestId?: string };
  try { payload = await request.json(); }
  catch { return Response.json({ error: "A valid JSON request body is required" }, { status: 400 }); }
  if (payload.action === "request") {
    const reason = payload.reason?.trim();
    if (reason && reason.length > 500) return Response.json({ error: "Reason must be 500 characters or fewer" }, { status: 400 });
    try { return Response.json({ deletionRequest: await requestWorkspaceDeletion(email, reason) }, { status: 201 }); }
    catch (error) { return failure(error); }
  }
  if (payload.action === "cancel") {
    const requestId = payload.requestId?.trim();
    if (!requestId || requestId.length > 80) return Response.json({ error: "A valid deletion request is required" }, { status: 400 });
    try { return Response.json({ deletionRequest: await cancelWorkspaceDeletion(email, requestId) }); }
    catch (error) { return failure(error); }
  }
  return Response.json({ error: "Choose request or cancel" }, { status: 400 });
}
