import { billingContext } from "@/db/business";
import { requestIdentity } from "@/server/request-identity";
import { publicRequestOrigin } from "@/server/request-origin";
import { createStripeCheckout } from "@/server/stripe";

export async function POST(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { plan?: string };
  try { payload = await request.json(); }
  catch { return Response.json({ error: "A valid JSON request body is required" }, { status: 400 }); }
  if (payload.plan !== "starter" && payload.plan !== "pro") return Response.json({ error: "Choose Starter or Pro" }, { status: 400 });
  try {
    const context = await billingContext(email);
    const url = await createStripeCheckout({ plan: payload.plan, workspaceId: context.workspaceId, email, origin: await publicRequestOrigin(request), customerId: context.customerId });
    return Response.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout could not be created";
    return Response.json({ error: message }, { status: message.includes("role") ? 403 : message.includes("configured") ? 503 : 502 });
  }
}
