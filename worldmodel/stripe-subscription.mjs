export const stripeSubscriptionUpsertSql =
  "INSERT INTO subscriptions (workspace_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, stripe_event_created, stripe_event_priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id), stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id), status = CASE WHEN excluded.stripe_event_priority = 0 AND subscriptions.status <> 'pending' THEN subscriptions.status ELSE excluded.status END, plan = CASE WHEN excluded.stripe_event_priority = 0 AND subscriptions.status <> 'pending' THEN subscriptions.plan ELSE excluded.plan END, current_period_end = COALESCE(excluded.current_period_end, subscriptions.current_period_end), stripe_event_created = CASE WHEN excluded.stripe_event_priority = 0 THEN subscriptions.stripe_event_created ELSE excluded.stripe_event_created END, stripe_event_priority = CASE WHEN excluded.stripe_event_priority = 0 THEN subscriptions.stripe_event_priority ELSE excluded.stripe_event_priority END, updated_at = CURRENT_TIMESTAMP WHERE excluded.stripe_event_priority = 0 OR excluded.stripe_event_created > subscriptions.stripe_event_created OR (excluded.stripe_event_created = subscriptions.stripe_event_created AND excluded.stripe_event_priority > subscriptions.stripe_event_priority)";

const lifecycleStatuses = new Set([
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

const terminalStatuses = new Set([
  "incomplete_expired",
  "canceled",
  "unpaid",
  "paused",
]);

export function stripeSubscriptionEventStatus(eventType, objectStatus) {
  if (eventType === "checkout.session.completed") return "pending";
  if (eventType === "customer.subscription.deleted") return "canceled";
  return typeof objectStatus === "string" && lifecycleStatuses.has(objectStatus)
    ? objectStatus
    : "pending";
}

export function stripeSubscriptionEventPriority(eventType, status) {
  if (eventType === "checkout.session.completed") return 0;
  return terminalStatuses.has(status) ? 2 : 1;
}
