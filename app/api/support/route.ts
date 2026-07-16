import { createSupportCase } from "@/db/operations";
import { requestIdentity } from "@/server/request-identity";

export async function POST(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { subject?: string; category?: string; priority?: string; body?: string };
  try { payload = await request.json(); }
  catch { return Response.json({ error: "A valid JSON request body is required" }, { status: 400 }); }
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
