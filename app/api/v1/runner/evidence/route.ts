import { acceptRunnerEvidence } from "@/server/github-oidc";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/server/bounded-request-body";

const MAX_EVIDENCE_BYTES = 5_000_000;

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Evidence rejected";
  const tooLarge = error instanceof RequestBodyTooLargeError;
  const unauthorized = message.startsWith("runner_unauthorized:");
  const conflict = message.startsWith("evidence_conflict:");
  const missing = message.startsWith("run_not_found:");
  const unavailable = message.startsWith("runner_not_configured:");
  const persistenceFailure = message.startsWith("evidence_persistence_failed:") || message.startsWith("evidence_integrity_error:");
  const serverFailure = unavailable || persistenceFailure || !/^(evidence_invalid|evidence_conflict|run_not_found|runner_unauthorized):/.test(message);
  const status = tooLarge ? 413 : unauthorized ? 401 : conflict ? 409 : missing ? 404 : unavailable ? 503 : serverFailure ? 500 : 400;
  const code = tooLarge ? "evidence_too_large" : unauthorized ? "runner_unauthorized" : conflict ? "evidence_conflict" : missing ? "run_not_found" : unavailable ? "runner_not_configured" : serverFailure ? "evidence_persistence_failed" : "evidence_rejected";
  const responseMessage = tooLarge
    ? "evidence_invalid: Evidence exceeds the 5 MB callback limit"
    : serverFailure && !unavailable && !persistenceFailure
      ? "evidence_persistence_failed: Observed evidence could not be processed"
      : message;
  return Response.json(
    {
      error: {
        code,
        message: responseMessage,
        retriable: status >= 500,
        correlationId: crypto.randomUUID(),
      },
    },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  try {
    if (!token || token.length > 4_096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error("runner_unauthorized: A valid run token is required");
    const raw = await readBoundedRequestText(request, MAX_EVIDENCE_BYTES);
    return Response.json(await acceptRunnerEvidence(token, raw), { status: 202 });
  } catch (error) {
    return failure(error);
  }
}
