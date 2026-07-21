const BACKENDS = new Set(["github_actions"]);

function hasMethod(value, method) {
  return Boolean(value && typeof value === "object" && typeof value[method] === "function");
}

export function evaluateCampaignExecutionReadiness(env, backend) {
  const selectedBackend = String(backend || "");
  const missing = [];

  if (!BACKENDS.has(selectedBackend)) missing.push("execution backend");
  if (!hasMethod(env?.CAMPAIGN_ORCHESTRATOR, "create")) missing.push("campaign orchestrator");
  if (!hasMethod(env?.ARTIFACTS, "put")) missing.push("ARTIFACTS evidence store");

  if (selectedBackend === "github_actions" && !hasMethod(env?.GITHUB_ACTIONS_RUNNER, "fetch")) {
    missing.push("GitHub Actions runner adapter");
  }

  const ready = missing.length === 0;
  const local = env?.LOCAL_DEVELOPMENT === "true";
  const message = ready
    ? "GitHub Actions campaign execution is ready."
    : local
      ? "This local preview has no durable campaign orchestrator. Configure the GitHub Actions integration before approval."
      : `Campaign execution is missing: ${missing.join(", ")}.`;

  return {
    ready,
    backend: selectedBackend || "unselected",
    code: ready ? "execution_ready" : "runner_not_configured",
    message,
    missing,
  };
}
