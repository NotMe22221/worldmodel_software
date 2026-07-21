import { recordAudit } from "./audit.ts";
import { ensureSaasSchema } from "./saas.ts";
import { getRuntimeEnv } from "../server/runtime-env.ts";
import { planCatalog } from "../worldmodel/entitlements.mjs";
import {
  stripeSubscriptionEventPriority,
  stripeSubscriptionEventStatus,
  stripeSubscriptionUpsertSql,
} from "../worldmodel/stripe-subscription.mjs";

type StripeEvent = {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
};

const supportedEvents = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
]);

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

async function runtimeDb() {
  const db = (await getRuntimeEnv()).DB;
  if (!db) throw new Error("Durable database is unavailable");
  return db;
}

async function recordBillingEvent(event: StripeEvent) {
  const db = await runtimeDb();
  await db
    .prepare("INSERT OR IGNORE INTO billing_events (event_id, event_type) VALUES (?, ?)")
    .bind(event.id, event.type)
    .run();
}

export async function processStripeEvent(event: StripeEvent) {
  if (!Number.isSafeInteger(event.created) || event.created <= 0) {
    throw new Error("Stripe event creation time is invalid");
  }

  await ensureSaasSchema();
  const db = await runtimeDb();
  const processed = await db
    .prepare("SELECT event_id FROM billing_events WHERE event_id = ?")
    .bind(event.id)
    .first();
  if (processed) return { duplicate: true };

  if (!supportedEvents.has(event.type)) {
    await recordBillingEvent(event);
    return { ignored: true };
  }

  const object = event.data.object;
  const metadata = object.metadata && typeof object.metadata === "object"
    ? object.metadata as Record<string, unknown>
    : {};
  const workspaceId = stringField(metadata, "workspace_id") || stringField(object, "client_reference_id");
  if (!workspaceId) {
    await recordBillingEvent(event);
    return { ignored: true };
  }

  const workspace = await db
    .prepare("SELECT id FROM workspaces WHERE id = ?")
    .bind(workspaceId)
    .first();
  if (!workspace) {
    await recordBillingEvent(event);
    return { ignored: true };
  }

  const requestedPlan = stringField(metadata, "plan") || "pro";
  const plan = requestedPlan === "starter" || requestedPlan === "business" ? requestedPlan : "pro";
  const customer = stringField(object, "customer");
  const checkoutCompleted = event.type === "checkout.session.completed";
  const subscriptionId = checkoutCompleted ? stringField(object, "subscription") : stringField(object, "id");

  // Checkout completion is not a subscription lifecycle state. It can enrich
  // identifiers but must not override a lifecycle event that arrived first.
  const status = stripeSubscriptionEventStatus(event.type, stringField(object, "status"));
  const eventPriority = stripeSubscriptionEventPriority(event.type, status);
  const eventCreated = eventPriority === 0 ? 0 : event.created;
  const periodEnd = typeof object.current_period_end === "number"
    ? new Date(object.current_period_end * 1000).toISOString()
    : null;
  const applied = await db
    .prepare(stripeSubscriptionUpsertSql)
    .bind(workspaceId, customer, subscriptionId, status, plan, periodEnd, eventCreated, eventPriority)
    .run();
  const persisted = await db
    .prepare("SELECT status, plan FROM subscriptions WHERE workspace_id = ?")
    .bind(workspaceId)
    .first<{ status: string; plan: string }>();
  const effectiveStatus = persisted?.status || status;
  const effectivePlan = persisted?.plan === "starter" || persisted?.plan === "business"
    ? persisted.plan
    : "pro";

  if (!applied.meta.changes) {
    await recordBillingEvent(event);
    return { duplicate: false, ignored: true, stale: true, workspaceId, status: effectiveStatus };
  }

  const provisioned = effectiveStatus === "active" || effectiveStatus === "trialing" || effectiveStatus === "past_due";
  const terminal = ["canceled", "unpaid", "paused", "incomplete_expired"].includes(effectiveStatus);
  if (provisioned) {
    await db
      .prepare("UPDATE workspaces SET plan = ?, monthly_limit = ? WHERE id = ?")
      .bind(effectivePlan, planCatalog[effectivePlan].simulationMinutes, workspaceId)
      .run();
  }
  if (terminal) {
    await db
      .prepare("UPDATE workspaces SET plan = 'free', monthly_limit = ? WHERE id = ?")
      .bind(planCatalog.free.simulationMinutes, workspaceId)
      .run();
  }

  await recordBillingEvent(event);
  await recordAudit({
    workspaceId,
    actorEmail: "stripe@system.worldmodel",
    action: "subscription.updated",
    targetType: "subscription",
    targetId: subscriptionId,
    summary: `Subscription status changed to ${effectiveStatus}`,
    metadata: { plan: effectivePlan, eventType: event.type },
  });
  return { duplicate: false, workspaceId, status: effectiveStatus };
}
