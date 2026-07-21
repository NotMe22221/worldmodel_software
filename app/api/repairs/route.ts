import {
  approveRepair,
  getRepairPacket,
  prepareRepairPullRequest,
  publishRepairPullRequest,
  requestRepairChanges,
  requestRepairReview,
} from "@/db/repairs";
import { readBoundedRequestJson, RequestBodyTooLargeError } from "@/server/bounded-request-body";
import { requestIdentity } from "@/server/request-identity";

const MAX_REPAIR_BODY_BYTES = 16_384;

function failure(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Repair workflow could not be completed";
  const status =
    message.includes("role") || message.includes("assigned to another")
      ? 403
      : message.includes("not found")
        ? 404
        : message.includes("not configured")
          ? 503
          : message.includes("GitHub request failed")
            ? 502
            : message.includes("plan") || message.includes("Payment")
              ? 402
              : message.includes("must be approved") ||
                  message.includes("Sample repair") ||
                  message.includes("ownership is unverified") ||
                  message.includes("not awaiting") ||
                  message.includes("not ready")
                ? 409
                : 400;
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const email = await requestIdentity(request);
  if (!email)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const proposalId = new URL(request.url).searchParams.get("proposal")?.trim();
  if (!proposalId)
    return Response.json(
      { error: "A repair proposal is required" },
      { status: 400 },
    );
  try {
    const packet = await getRepairPacket(email, proposalId);
    return new Response(JSON.stringify(packet, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="worldmodel-${proposalId}-repair-packet.json"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const email = await requestIdentity(request);
  if (!email)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: {
    action?: string;
    proposalId?: string;
    reviewerEmail?: string;
    note?: string;
  };
  try {
    payload = await readBoundedRequestJson(request, MAX_REPAIR_BODY_BYTES);
  } catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError;
    return Response.json(
      { error: tooLarge ? "Request body exceeds 16 KB" : "A valid JSON request body is required" },
      { status: tooLarge ? 413 : 400 },
    );
  }
  if (!payload.proposalId || payload.proposalId.length > 120)
    return Response.json(
      { error: "A valid repair proposal is required" },
      { status: 400 },
    );
  try {
    if (payload.action === "request-review")
      return Response.json({
        repair: await requestRepairReview(
          email,
          payload.proposalId,
          payload.reviewerEmail,
        ),
      });
    if (payload.action === "approve")
      return Response.json({
        repair: await approveRepair(
          email,
          payload.proposalId,
          payload.note || "",
        ),
      });
    if (payload.action === "request-changes")
      return Response.json({
        repair: await requestRepairChanges(
          email,
          payload.proposalId,
          payload.note || "",
        ),
      });
    if (payload.action === "prepare-pr")
      return Response.json({
        repair: await prepareRepairPullRequest(email, payload.proposalId),
      });
    if (payload.action === "publish-pr")
      return Response.json({
        repair: await publishRepairPullRequest(email, payload.proposalId),
      });
    return Response.json(
      { error: "Choose a supported repair action" },
      { status: 400 },
    );
  } catch (error) {
    return failure(error);
  }
}
