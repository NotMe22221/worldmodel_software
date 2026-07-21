import { getRuntimeEnv, isLocalDevelopmentEnvironment } from "./runtime-env.ts";
import { loadLocalProviderSettings } from "./provider-settings.ts";

type RuntimeEnvironment = Record<string, string | undefined>;

export const COMPOSIO_REQUIRED_ENVIRONMENT_VARIABLES = [
  "COMPOSIO_API_KEY",
] as const;

export async function effectiveRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  const env = await getRuntimeEnv() as RuntimeEnvironment;
  if (isLocalDevelopmentEnvironment(env)) return { ...env, ...await loadLocalProviderSettings() };
  return env;
}

function normalized(value: string | undefined) {
  return value?.trim() || null;
}

export function composioConfigurationStatusForEnvironment(env: RuntimeEnvironment) {
  const missing = COMPOSIO_REQUIRED_ENVIRONMENT_VARIABLES.filter((name) => !normalized(env[name]));
  const configured = missing.length === 0;
  return {
    configured,
    githubConfigured: configured,
    fixture: env.COMPOSIO_FIXTURE_MODE === "true" && isLocalDevelopmentEnvironment(env),
    missing,
  };
}

export async function businessConfiguration() {
  const env = await effectiveRuntimeEnvironment();
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
    composio: composioConfigurationStatusForEnvironment(env),
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
      campaignOrchestrator: Boolean((env as unknown as Record<string, unknown>).CAMPAIGN_ORCHESTRATOR),
      artifacts: Boolean((env as unknown as Record<string, unknown>).ARTIFACTS),
      githubActionsRunner: Boolean((env as unknown as Record<string, unknown>).GITHUB_ACTIONS_RUNNER),
    },
  };
}

export async function composioConfiguration() {
  const env = await effectiveRuntimeEnvironment();
  const apiKey = normalized(env.COMPOSIO_API_KEY);
  const githubAuthConfigId = normalized(env.COMPOSIO_GITHUB_AUTH_CONFIG_ID);
  const fixtureMode = env.COMPOSIO_FIXTURE_MODE === "true" && isLocalDevelopmentEnvironment(env);
  const baseUrl = normalized(env.COMPOSIO_API_BASE_URL) || "https://backend.composio.dev/api/v3.1";
  if (!apiKey) throw new Error("Composio GitHub connection is not configured");
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

export function parseOperatorUserIds(value: string | undefined) {
  return new Set(
    (value || "")
      .split(",")
      .map((userId) => userId.trim())
      .filter((userId) => /^usr_[a-f0-9]{32}$/i.test(userId)),
  );
}

export async function hasOperatorAccess(email: string, userId?: string) {
  const env = await effectiveRuntimeEnvironment();
  const emailAllowed = parseOperatorEmails(env.WORLDMODEL_OPERATOR_EMAILS).has(email.trim().toLowerCase());
  if (!emailAllowed) return false;
  if (isLocalDevelopmentEnvironment(env)) return true;
  return Boolean(userId && parseOperatorUserIds(env.WORLDMODEL_OPERATOR_USER_IDS).has(userId));
}
