import { processStripeEvent } from "@/db/business";
import { stripeConfiguration } from "@/server/runtime-config";
import { verifyStripeSignature } from "@/server/stripe";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Stripe signature required" }, { status: 400 });
  try {
    const config = await stripeConfiguration();
    if (!(await verifyStripeSignature(rawBody, signature, config.webhookSecret))) return Response.json({ error: "Invalid Stripe signature" }, { status: 400 });
    const event = JSON.parse(rawBody) as { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
    if (!event.id || !event.type || !event.data?.object) return Response.json({ error: "Invalid Stripe event" }, { status: 400 });
    const result = await processStripeEvent(event as { id: string; type: string; data: { object: Record<string, unknown> } });
    return Response.json({ received: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe webhook failed";
    return Response.json({ error: message }, { status: message.includes("configured") ? 503 : 500 });
  }
}
