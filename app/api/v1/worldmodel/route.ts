import { approveCampaign, approveDecisionReport, approveModelVersion, assistantMessage, cancelCampaign, createJourney, createModelVersion, productSnapshot, publishDecisionDraftPr, rescanRepository, runEvents, saveEnvironment, shareDecisionReport, startInvestigation } from "@/db/product";
import { requestIdentity } from "@/server/request-identity";

function errorResponse(error: unknown, correlationId: string) {
  const raw = error instanceof Error ? error.message : "internal_error: The request could not be completed";
  const separator = raw.indexOf(":");
  const code = separator > 0 ? raw.slice(0, separator).trim() : "internal_error";
  const message = separator > 0 ? raw.slice(separator + 1).trim() : raw;
  const status = code.endsWith("_not_found") ? 404 : code.includes("not_configured") || code === "project_not_ready" ? 409 : code.includes("invalid") ? 400 : code.includes("unauthorized") ? 403 : code.includes("request_failed") ? 502 : 500;
  return Response.json({ error: { code, message, retriable: status >= 500 || code === "runner_not_configured", correlationId } }, { status, headers: { "x-correlation-id": correlationId } });
}

export async function GET(request: Request) {
  const correlationId = crypto.randomUUID();
  const email = await requestIdentity(request);
  if (!email) return errorResponse(new Error("unauthorized: Authentication is required"), correlationId);
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") || "";
  try {
    if (!projectId) throw new Error("request_invalid: projectId is required");
    const runId = url.searchParams.get("runId");
    if (runId) return Response.json({ events: await runEvents(email, projectId, runId, Number(url.searchParams.get("after") || 0)), correlationId });
    return Response.json({ ...(await productSnapshot(email, projectId)), correlationId });
  } catch (error) { return errorResponse(error, correlationId); }
}

export async function POST(request: Request) {
  const correlationId = crypto.randomUUID();
  const email = await requestIdentity(request);
  if (!email) return errorResponse(new Error("unauthorized: Authentication is required"), correlationId);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return errorResponse(new Error("request_invalid: A valid JSON body is required"), correlationId); }
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  try {
    if (!projectId) throw new Error("request_invalid: projectId is required");
    let result: unknown;
    switch (body.action) {
      case "create-model": result = await createModelVersion(email, projectId, { commitSha: String(body.commitSha || ""), graph: body.graph, confidence: Number(body.confidence || 0) }); break;
      case "approve-model": result = await approveModelVersion(email, projectId, String(body.modelVersionId || ""), body.overrides); break;
      case "save-environment": result = await saveEnvironment(email, projectId, { modelVersionId: String(body.modelVersionId || ""), backend: String(body.backend || ""), manifest: body.manifest, approve: body.approve === true }); break;
      case "create-journey": result = await createJourney(email, projectId, body.definition, String(body.source || "user"), body.approve === true); break;
      case "assistant-message": result = await assistantMessage(email, projectId, { conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined, message: String(body.message || "") }); break;
      case "approve-campaign": result = await approveCampaign(email, projectId, String(body.campaignId || "")); break;
      case "cancel-campaign": result = await cancelCampaign(email, projectId, String(body.campaignId || "")); break;
      case "start-investigation": result = await startInvestigation(email, projectId, { runId: String(body.runId || ""), objective: String(body.objective || "balanced") }); break;
      case "rescan-repository": result = await rescanRepository(email, projectId); break;
      case "share-report": result = await shareDecisionReport(email, projectId, String(body.reportId || "")); break;
      case "approve-report": result = await approveDecisionReport(email, projectId, String(body.reportId || ""), String(body.decisionNote || "")); break;
      case "publish-draft-pr": result = await publishDecisionDraftPr(email, projectId, String(body.reportId || "")); break;
      default: throw new Error("request_invalid: Unknown WorldModel action");
    }
    return Response.json({ result, correlationId }, { status: 201, headers: { "x-correlation-id": correlationId } });
  } catch (error) { return errorResponse(error, correlationId); }
}
