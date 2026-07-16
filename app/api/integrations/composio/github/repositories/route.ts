import { disconnectComposioGithub, importComposioGithubRepository, syncComposioGithubConnection } from "@/db/composio";
import { requestIdentity } from "@/server/request-identity";

type Action = { action?: "sync" | "import" | "disconnect"; connectionId?: string; repositoryId?: string };

function failure(error: unknown, correlationId: string) {
  const message = error instanceof Error ? error.message : "Composio GitHub request failed";
  const status = message.includes("role") ? 403 : message.includes("not found") ? 404 : message.includes("not active") ? 409 : message.includes("Composio") ? 502 : 400;
  return Response.json({ error: { message, code: "COMPOSIO_GITHUB_OPERATION_FAILED", retriable: status >= 500, correlationId } }, { status, headers: { "x-correlation-id": correlationId } });
}

export async function POST(request: Request) {
  const correlationId = crypto.randomUUID();
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: { message: "Authentication required", code: "AUTH_REQUIRED", retriable: false, correlationId } }, { status: 401 });
  let payload: Action;
  try { payload = await request.json() as Action; }
  catch { return Response.json({ error: { message: "A valid JSON body is required", code: "INVALID_JSON", retriable: false, correlationId } }, { status: 400 }); }
  try {
    if (payload.action === "sync" && payload.connectionId) return Response.json({ repositories: await syncComposioGithubConnection(email, payload.connectionId), correlationId });
    if (payload.action === "import" && payload.repositoryId) return Response.json({ project: await importComposioGithubRepository(email, payload.repositoryId), correlationId }, { status: 201 });
    if (payload.action === "disconnect" && payload.connectionId) return Response.json({ ...(await disconnectComposioGithub(email, payload.connectionId)), correlationId });
    return Response.json({ error: { message: "Choose a valid Composio GitHub action", code: "INVALID_ACTION", retriable: false, correlationId } }, { status: 400 });
  } catch (error) { return failure(error, correlationId); }
}
