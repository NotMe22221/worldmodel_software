import { createSupportCase } from "@/db/operations";
import { readBoundedRequestJson, RequestBodyTooLargeError } from "@/server/bounded-request-body";
import { requestIdentity } from "@/server/request-identity";

const MAX_SUPPORT_BODY_BYTES = 16_384;

export async function POST(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { subject?: string; category?: string; priority?: string; body?: string };
  try { payload = await readBoundedRequestJson(request, MAX_SUPPORT_BODY_BYTES); }
  catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError;
    return Response.json({ error: tooLarge ? "Request body exceeds 16 KB" : "A valid JSON request body is required" }, { status: tooLarge ? 413 : 400 });
  }
  const subject = payload.subject?.trim();
  const body = payload.body?.trim();
  const categories = ["product", "simulation", "integration", "billing", "security"];
  const priorities = ["normal", "high", "urgent"];
  const category = categories.includes(payload.category || "") ? payload.category! : "product";
  const priority = priorities.includes(payload.priority || "") ? payload.priority! : "normal";
  if (!subject || subject.length > 120 || !body || body.length > 4000) return Response.json({ error: "Subject and details are required within the allowed length" }, { status: 400 });
  try { return Response.json({ supportCase: await createSupportCase(email, { subject, category, priority, body }) }, { status: 201 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Support case could not be created" }, { status: 500 }); }
}
