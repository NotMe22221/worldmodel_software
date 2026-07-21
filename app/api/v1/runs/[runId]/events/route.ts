import { runEvents } from "@/db/product";
import { requestIdentity } from "@/server/request-identity";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: { code: "unauthorized", message: "Authentication is required" } }, { status: 401 });
  const { runId } = await context.params;
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") || "";
  if (!projectId) return Response.json({ error: { code: "request_invalid", message: "projectId is required" } }, { status: 400 });
  try {
    return Response.json({ events: await runEvents(email, projectId, runId, Number(url.searchParams.get("after") || 0)) });
  } catch (error) {
    return Response.json({ error: { code: "events_unavailable", message: error instanceof Error ? error.message : "Unable to read run events" } }, { status: 500 });
  }
}
