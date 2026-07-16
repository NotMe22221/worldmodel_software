import { getRuntimeEnv } from "./runtime-env.ts";
import { loadLocalProviderSettings } from "./provider-settings.ts";

type RuntimeEnvironment = Record<string, string | undefined>;

export async function effectiveRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  const env = await getRuntimeEnv() as RuntimeEnvironment;
  if (env.LOCAL_DEVELOPMENT === "true") return { ...env, ...await loadLocalProviderSettings() };
  return env;
}

function normalized(value: string | undefined) {
  return value?.trim() || null;
}

export async function businessConfiguration() {
  const env = await effectiveRuntimeEnvironment();
  const composioApiKey = normalized(env.COMPOSIO_API_KEY);
  const composioAuthConfigId = normalized(env.COMPOSIO_GITHUB_AUTH_CONFIG_ID);
  const githubSlug = normalized(env.GITHUB_APP_SLUG);
  const githubConfigured = Boolean(
    githubSlug &&
    normalized(env.GITHUB_CLIENT_ID) &&
    normalized(env.GITHUB_CLIENT_SECRET) &&
    normalized(env.GITHUB_APP_ID) &&
    normalized(env.GITHUB_APP_PRIVATE_KEY),
  );
  const stripeConfigured = Boolean(
    normalized(env.STRIPE_SECRET_KEY) &&
    normalized(env.STRIPE_WEBHOOK_SECRET) &&
    normalized(env.STRIPE_PRICE_STARTER) &&
    normalized(env.STRIPE_PRICE_PRO),
  );
  return {
    composio: {
      configured: Boolean(composioApiKey && composioAuthConfigId),
      githubConfigured: Boolean(composioApiKey && composioAuthConfigId),
      fixture: env.COMPOSIO_FIXTURE_MODE === "true" && env.LOCAL_DEVELOPMENT === "true",
    },
    github: { configured: githubConfigured, appSlug: githubSlug },
    billing: {
      configured: stripeConfigured,
      portalConfigured: Boolean(normalized(env.STRIPE_SECRET_KEY)),
    },
    intelligence: {
      configured: Boolean(normalized(env.OPENAI_API_KEY)),
      model: normalized(env.OPENAI_AGENT_MODEL) || "gpt-5.6",
    },
    execution: {
      campaignWorkflow: Boolean((env as unknown as Record<string, unknown>).WORLDMODEL_CAMPAIGN),
      eventHub: Boolean((env as unknown as Record<string, unknown>).RUN_EVENTS),
      artifacts: Boolean((env as unknown as Record<string, unknown>).ARTIFACTS),
      sandboxRunner: Boolean((env as unknown as Record<string, unknown>).SANDBOX_RUNNER),
      githubActionsRunner: Boolean((env as unknown as Record<string, unknown>).GITHUB_ACTIONS_RUNNER),
    },
  };
}

export async function composioConfiguration() {
  const env = await effectiveRuntimeEnvironment();
  const apiKey = normalized(env.COMPOSIO_API_KEY);
  const githubAuthConfigId = normalized(env.COMPOSIO_GITHUB_AUTH_CONFIG_ID);
  const fixtureMode = env.COMPOSIO_FIXTURE_MODE === "true" && env.LOCAL_DEVELOPMENT === "true";
  const baseUrl = normalized(env.COMPOSIO_API_BASE_URL) || "https://backend.composio.dev/api/v3.1";
  if (!apiKey || !githubAuthConfigId) throw new Error("Composio GitHub connection is not configured");
  const parsed = new URL(baseUrl);
  const official = parsed.protocol === "https:" && parsed.hostname === "backend.composio.dev";
  const localFixture = fixtureMode && parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  if (!official && !localFixture) throw new Error("Composio API origin is not allowed");
  return { apiKey, githubAuthConfigId, baseUrl: parsed.toString().replace(/\/$/, ""), fixtureMode };
}

export async function githubConfiguration() {
  const env = await effectiveRuntimeEnvironment();
  const config = {
    appSlug: normalized(env.GITHUB_APP_SLUG),
    appId: normalized(env.GITHUB_APP_ID),
    privateKey: normalized(env.GITHUB_APP_PRIVATE_KEY),
    clientId: normalized(env.GITHUB_CLIENT_ID),
    clientSecret: normalized(env.GITHUB_CLIENT_SECRET),
  };
  if (Object.values(config).some((value) => !value))
    throw new Error("GitHub App credentials are not configured");
  return config as {
    appSlug: string;
    appId: string;
    privateKey: string;
    clientId: string;
    clientSecret: string;
  };
}

export async function stripeConfiguration() {
  const env = await effectiveRuntimeEnvironment();
  const config = {
    secretKey: normalized(env.STRIPE_SECRET_KEY),
    webhookSecret: normalized(env.STRIPE_WEBHOOK_SECRET),
    starterPrice: normalized(env.STRIPE_PRICE_STARTER),
    proPrice: normalized(env.STRIPE_PRICE_PRO),
  };
  if (Object.values(config).some((value) => !value))
    throw new Error("Stripe billing credentials are not configured");
  return config as {
    secretKey: string;
    webhookSecret: string;
    starterPrice: string;
    proPrice: string;
  };
}

export async function stripeSecretConfiguration() {
  const env = await effectiveRuntimeEnvironment();
  const secretKey = normalized(env.STRIPE_SECRET_KEY);
  if (!secretKey)
    throw new Error("Stripe billing credentials are not configured");
  return { secretKey };
}

export function parseOperatorEmails(value: string | undefined) {
  return new Set(
    (value || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
  );
}

export async function hasOperatorAccess(email: string) {
  const env = await effectiveRuntimeEnvironment();
  return parseOperatorEmails(env.WORLDMODEL_OPERATOR_EMAILS).has(
    email.trim().toLowerCase(),
  );
}
