import { runEvents } from "@/db/product";
import { requestIdentity } from "@/server/request-identity";
import { getRuntimeEnv } from "@/server/runtime-env";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: { code: "unauthorized", message: "Authentication is required" } }, { status: 401 });
  const { runId } = await context.params;
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") || "";
  if (!projectId) return Response.json({ error: { code: "request_invalid", message: "projectId is required" } }, { status: 400 });
  try {
    await runEvents(email, projectId, runId, Number(url.searchParams.get("after") || 0));
    if (request.headers.get("Upgrade") !== "websocket") return Response.json({ events: await runEvents(email, projectId, runId, Number(url.searchParams.get("after") || 0)) });
    const namespace = (await getRuntimeEnv() as { RUN_EVENTS?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } } }).RUN_EVENTS;
    if (!namespace) return Response.json({ error: { code: "events_not_configured", message: "Live event streaming is not configured" } }, { status: 503 });
    const stub = namespace.get(namespace.idFromName(runId));
    return stub.fetch(new Request("https://events.internal/connect", request));
  } catch (error) {
    return Response.json({ error: { code: "events_unavailable", message: error instanceof Error ? error.message : "Unable to read run events" } }, { status: 500 });
  }
}
