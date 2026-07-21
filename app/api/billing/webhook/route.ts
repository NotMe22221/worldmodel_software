import { processStripeEvent } from "@/db/stripe";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/server/bounded-request-body";
import { stripeConfiguration } from "@/server/runtime-config";
import { verifyStripeSignature } from "@/server/stripe";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Stripe signature required" }, { status: 400 });
  try {
    const rawBody = await readBoundedRequestText(request, 1_000_000);
    const config = await stripeConfiguration();
    if (!(await verifyStripeSignature(rawBody, signature, config.webhookSecret))) return Response.json({ error: "Invalid Stripe signature" }, { status: 400 });
    const event = JSON.parse(rawBody) as { id?: string; type?: string; created?: number; data?: { object?: Record<string, unknown> } };
    if (!event.id || !event.type || !Number.isSafeInteger(event.created) || Number(event.created) <= 0 || !event.data?.object) return Response.json({ error: "Invalid Stripe event" }, { status: 400 });
    const result = await processStripeEvent(event as { id: string; type: string; created: number; data: { object: Record<string, unknown> } });
    return Response.json({ received: true, ...result });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Stripe event exceeds 1 MB" }, { status: 413 });
    if (error instanceof SyntaxError || error instanceof TypeError) return Response.json({ error: "Invalid Stripe event" }, { status: 400 });
    const message = error instanceof Error ? error.message : "Stripe webhook failed";
    return Response.json({ error: message }, { status: message.includes("configured") ? 503 : 500 });
  }
}
