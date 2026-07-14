import { stripeConfiguration } from "./runtime-config.ts";

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = signatureHeader.split(",").map((part) => part.split("=", 2));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300 || signatures.length === 0) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = bytesToHex(new Uint8Array(digest));
  return signatures.some((signature) => constantTimeEqual(signature, expected));
}

export async function createStripeCheckout(input: { plan: "starter" | "pro"; workspaceId: string; email: string; origin: string; customerId?: string | null }) {
  const config = await stripeConfiguration();
  const price = input.plan === "starter" ? config.starterPrice : config.proPrice;
  const body = new URLSearchParams({ mode: "subscription", "line_items[0][price]": price, "line_items[0][quantity]": "1", success_url: `${input.origin}/dashboard?billing=success`, cancel_url: `${input.origin}/dashboard?billing=canceled`, client_reference_id: input.workspaceId, "metadata[workspace_id]": input.workspaceId, "metadata[plan]": input.plan, "subscription_data[metadata][workspace_id]": input.workspaceId, "subscription_data[metadata][plan]": input.plan, allow_promotion_codes: "true" });
  if (input.customerId) body.set("customer", input.customerId); else body.set("customer_email", input.email);
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { authorization: `Bearer ${config.secretKey}`, "content-type": "application/x-www-form-urlencoded" }, body });
  const payload = await response.json() as { url?: string; error?: { message?: string } };
  if (!response.ok || !payload.url) throw new Error(payload.error?.message || "Stripe Checkout could not be created");
  return payload.url;
}
