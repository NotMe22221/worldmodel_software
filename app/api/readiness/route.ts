import { setLaunchCheck } from "@/db/operations";
import { readBoundedRequestJson, RequestBodyTooLargeError } from "@/server/bounded-request-body";
import { requestIdentity } from "@/server/request-identity";

const MAX_READINESS_BODY_BYTES = 4_096;

export async function POST(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { key?: string; passed?: boolean; evidence?: string };
  try { payload = await readBoundedRequestJson(request, MAX_READINESS_BODY_BYTES); }
  catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError;
    return Response.json({ error: tooLarge ? "Request body exceeds 4 KB" : "A valid JSON request body is required" }, { status: tooLarge ? 413 : 400 });
  }
  const key = payload.key?.trim();
  const evidence = payload.evidence?.trim() || "";
  if (!key || evidence.length > 500 || typeof payload.passed !== "boolean") return Response.json({ error: "A valid check, status, and evidence under 500 characters are required" }, { status: 400 });
  if (payload.passed && !evidence) return Response.json({ error: "Evidence is required to complete an attested check" }, { status: 400 });
  try { return Response.json({ launchCheck: await setLaunchCheck(email, { key, passed: payload.passed, evidence }) }); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Launch check could not be updated";
    return Response.json({ error: message }, { status: message.includes("role") ? 403 : message.includes("Unsupported") ? 400 : 500 });
  }
}
