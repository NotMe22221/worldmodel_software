export const planCatalog = {
  free: { key: "free", name: "Free", simulationMinutes: 50, projects: 1, seats: 1, apiKeys: 0 },
  pro_trial: { key: "pro_trial", name: "Pro trial", simulationMinutes: 500, projects: 10, seats: 5, apiKeys: 2 },
  starter: { key: "starter", name: "Starter", simulationMinutes: 150, projects: 3, seats: 1, apiKeys: 2 },
  pro: { key: "pro", name: "Pro", simulationMinutes: 500, projects: 10, seats: 5, apiKeys: 10 },
  business: { key: "business", name: "Business", simulationMinutes: 2000, projects: 1000, seats: 20, apiKeys: 25 },
};

function timestamp(value) {
  if (!value) return Number.NaN;
  const normalized = /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(normalized);
}

export function usagePeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

export function resolveEntitlements({ workspace, subscription, now = new Date() }) {
  const status = subscription?.status || null;
  const requestedPlan = ["starter", "pro", "business"].includes(subscription?.plan) ? subscription.plan : "pro";
  const trialEndsAt = workspace.trial_ends_at || null;
  const trialActive = timestamp(trialEndsAt) > now.getTime();
  let planKey;
  let lifecycle;
  let access = "full";
  let message;

  if (status === "active" || status === "trialing") {
    planKey = requestedPlan;
    lifecycle = status === "trialing" ? "subscription_trial" : "active";
    message = status === "trialing" ? "Stripe trial is active." : "Subscription is active.";
  } else if (status === "past_due") {
    planKey = requestedPlan;
    lifecycle = "past_due";
    access = "read_only";
    message = "Payment requires attention. Existing evidence remains available, but write actions are paused.";
  } else if ((!status || status === "pending" || status === "incomplete") && trialActive) {
    planKey = "pro_trial";
    lifecycle = "trial";
    message = "Local Pro trial is active.";
  } else {
    planKey = "free";
    lifecycle = status && ["canceled", "unpaid", "paused", "incomplete_expired"].includes(status) ? status : "free";
    message = status === "unpaid" || status === "paused" ? "Paid access is paused; Free plan limits apply." : status === "canceled" || status === "incomplete_expired" ? "Subscription ended; Free plan limits apply." : "Free plan is active.";
  }

  const plan = planCatalog[planKey];
  const period = usagePeriod(now);
  const trialDaysRemaining = trialActive ? Math.max(1, Math.ceil((timestamp(trialEndsAt) - now.getTime()) / 86_400_000)) : 0;
  return {
    planKey,
    planName: plan.name,
    lifecycle,
    billingStatus: status,
    access,
    canWrite: access === "full",
    message,
    limits: { simulationMinutes: plan.simulationMinutes, projects: plan.projects, seats: plan.seats, apiKeys: plan.apiKeys },
    trialEndsAt,
    trialDaysRemaining,
    usagePeriodStart: period.start,
    usagePeriodEnd: period.end,
  };
}
