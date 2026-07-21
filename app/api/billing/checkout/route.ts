import { billingContext } from "@/db/business";
import { readBoundedRequestJson, RequestBodyTooLargeError } from "@/server/bounded-request-body";
import { requestIdentity } from "@/server/request-identity";
import { publicRequestOrigin } from "@/server/request-origin";
import { createStripeCheckout } from "@/server/stripe";

const MAX_CHECKOUT_BODY_BYTES = 2_048;

export async function POST(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { plan?: string };
  try { payload = await readBoundedRequestJson(request, MAX_CHECKOUT_BODY_BYTES); }
  catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError;
    return Response.json({ error: tooLarge ? "Request body exceeds 2 KB" : "A valid JSON request body is required" }, { status: tooLarge ? 413 : 400 });
  }
  if (payload.plan !== "starter" && payload.plan !== "pro") return Response.json({ error: "Choose Starter or Pro" }, { status: 400 });
  try {
    const context = await billingContext(email);
    const url = await createStripeCheckout({ plan: payload.plan, workspaceId: context.workspaceId, email, origin: await publicRequestOrigin(request), customerId: context.customerId });
    return Response.json({ url }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout could not be created";
    return Response.json({ error: message }, { status: message.includes("role") ? 403 : message.includes("configured") ? 503 : 502 });
  }
}
