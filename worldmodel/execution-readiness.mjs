const BACKENDS = new Set(["cloudflare_sandbox", "github_actions"]);

function hasMethod(value, method) {
  return Boolean(value && typeof value === "object" && typeof value[method] === "function");
}

export function evaluateCampaignExecutionReadiness(env, backend) {
  const selectedBackend = String(backend || "");
  const missing = [];

  if (!BACKENDS.has(selectedBackend)) missing.push("execution backend");
  if (!hasMethod(env?.WORLDMODEL_CAMPAIGN, "create")) missing.push("WORLDMODEL_CAMPAIGN workflow");
  if (!hasMethod(env?.RUN_EVENTS, "get")) missing.push("RUN_EVENTS event hub");
  if (!hasMethod(env?.ARTIFACTS, "put")) missing.push("ARTIFACTS evidence store");

  if (selectedBackend === "cloudflare_sandbox" && !hasMethod(env?.SANDBOX_RUNNER, "fetch")) {
    missing.push("SANDBOX_RUNNER service");
  }
  if (selectedBackend === "github_actions" && !hasMethod(env?.GITHUB_ACTIONS_RUNNER, "fetch")) {
    missing.push("GITHUB_ACTIONS_RUNNER service");
  }

  const ready = missing.length === 0;
  const local = env?.LOCAL_DEVELOPMENT === "true";
  const message = ready
    ? selectedBackend === "github_actions"
      ? "GitHub Actions campaign execution is ready."
      : "Cloudflare Sandbox campaign execution is ready."
    : local
      ? "This local preview has no isolated durable campaign runner. Deploy the Cloudflare runtime or configure the GitHub Actions fallback before approval."
      : `Campaign execution is missing: ${missing.join(", ")}.`;

  return {
    ready,
    backend: selectedBackend || "unselected",
    code: ready ? "execution_ready" : "runner_not_configured",
    message,
    missing,
  };
}