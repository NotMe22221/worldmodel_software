import { recordAudit } from "@/db/audit";
import { billingContext } from "@/db/business";
import { requestIdentity } from "@/server/request-identity";
import { createStripePortal } from "@/server/stripe";

export async function POST(request: Request) {
  const email = await requestIdentity(request);
  if (!email)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const requestOrigin = new URL(request.url).origin;
  const browserOrigin = request.headers.get("origin");
  if (browserOrigin && browserOrigin !== requestOrigin)
    return Response.json(
      { error: "Cross-origin billing requests are not allowed" },
      { status: 403 },
    );
  try {
    const context = await billingContext(email);
    if (!context.customerId)
      return Response.json(
        { error: "A Stripe customer is not linked to this workspace" },
        { status: 409 },
      );
    const url = await createStripePortal({
      customerId: context.customerId,
      origin: requestOrigin,
    });
    await recordAudit({
      workspaceId: context.workspaceId,
      actorEmail: email,
      action: "billing.portal_opened",
      targetType: "subscription",
      targetId: null,
      summary: "Opened Stripe-hosted billing management",
    });
    return Response.json(
      { url },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Billing portal could not be created";
    return Response.json(
      { error: message },
      {
        status: message.includes("role")
          ? 403
          : message.includes("configured")
            ? 503
            : 502,
      },
    );
  }
}
