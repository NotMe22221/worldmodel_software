import { disconnectComposioGithub, importComposioGithubRepository, syncComposioGithubConnection } from "@/db/composio";
import { readBoundedRequestJson, RequestBodyTooLargeError } from "@/server/bounded-request-body";
import { requestIdentity } from "@/server/request-identity";

type Action = { action?: "sync" | "import" | "disconnect"; connectionId?: string; repositoryId?: string };
const MAX_COMPOSIO_ACTION_BODY_BYTES = 8_192;

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
  try { payload = await readBoundedRequestJson<Action>(request, MAX_COMPOSIO_ACTION_BODY_BYTES); }
  catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError;
    return Response.json({ error: { message: tooLarge ? "Request body exceeds 8 KB" : "A valid JSON body is required", code: tooLarge ? "REQUEST_TOO_LARGE" : "INVALID_JSON", retriable: false, correlationId } }, { status: tooLarge ? 413 : 400 });
  }
  try {
    if (payload.action === "sync" && payload.connectionId) return Response.json({ repositories: await syncComposioGithubConnection(email, payload.connectionId), correlationId });
    if (payload.action === "import" && payload.repositoryId) return Response.json({ project: await importComposioGithubRepository(email, payload.repositoryId), correlationId }, { status: 201 });
    if (payload.action === "disconnect" && payload.connectionId) return Response.json({ ...(await disconnectComposioGithub(email, payload.connectionId)), correlationId });
    return Response.json({ error: { message: "Choose a valid Composio GitHub action", code: "INVALID_ACTION", retriable: false, correlationId } }, { status: 400 });
  } catch (error) { return failure(error, correlationId); }
}
