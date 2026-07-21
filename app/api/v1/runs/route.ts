import { ApiAccessError, authenticateApiRequest, listApiRuns } from "@/db/developer-api";
import { createSimulationRunForWorkspace } from "@/db/saas";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/server/bounded-request-body";

function apiFailure(error: unknown, headers: Record<string, string> = {}) {
  if (error instanceof ApiAccessError) return Response.json({ error: { code: error.status === 429 ? "rate_limit_exceeded" : error.status === 403 ? "insufficient_scope" : error.status === 402 ? "subscription_required" : "unauthorized", message: error.message } }, { status: error.status, headers: error.headers });
  const message = error instanceof Error ? error.message : "Request failed";
  const status = message.includes("not found") ? 404 : message.includes("limit") ? 429 : /required|invalid|must|between|match|future|timestamps|scenario|already used/.test(message) ? 400 : 500;
  return Response.json({ error: { code: status === 404 ? "not_found" : status === 429 ? "usage_limit_exceeded" : status === 400 ? "invalid_request" : "internal_error", message } }, { status, headers });
}

export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request, "runs:read");
    return Response.json({ data: await listApiRuns(context.workspaceId) }, { headers: context.rateHeaders });
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: Request) {
  let context;
  try { context = await authenticateApiRequest(request, "runs:write"); }
  catch (error) { return apiFailure(error); }
  let payload: { action?: string; projectId?: string; scenario?: string; runId?: string; [key: string]: unknown };
  try { payload = JSON.parse(await readBoundedRequestText(request, 16_384)); }
  catch (error) { return Response.json({ error: { code: error instanceof RequestBodyTooLargeError ? "request_too_large" : "invalid_request", message: error instanceof RequestBodyTooLargeError ? "Request body exceeds 16 KB" : "A valid JSON request body is required" } }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers: context.rateHeaders }); }
  try {
    if (payload.action === "observe" || payload.action === "verify") {
      return Response.json({ error: { code: "signed_runner_required", message: "API keys cannot promote self-attested metrics to verified evidence. Use the project GitHub Actions workflow and signed runner evidence exchange." } }, { status: 403, headers: context.rateHeaders });
    }
    if (!payload.projectId) return Response.json({ error: { code: "invalid_request", message: "projectId is required" } }, { status: 400, headers: context.rateHeaders });
    const scenario = payload.scenario;
    if (scenario !== "traffic" && scenario !== "database" && scenario !== "payments") return Response.json({ error: { code: "invalid_request", message: "scenario must be traffic, database, or payments" } }, { status: 400, headers: context.rateHeaders });
    const run = await createSimulationRunForWorkspace(context.workspaceId, context.actor, scenario, payload.projectId);
    return Response.json({ data: run }, { status: 201, headers: { ...context.rateHeaders, location: `/api/v1/runs?id=${encodeURIComponent(String((run as { id?: string })?.id || ""))}` } });
  } catch (error) { return apiFailure(error, context.rateHeaders); }
}
