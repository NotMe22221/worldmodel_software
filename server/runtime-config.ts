type RuntimeEnvironment = Record<string, string | undefined>;

async function runtimeEnvironment(): Promise<RuntimeEnvironment> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as RuntimeEnvironment;
}

function normalized(value: string | undefined) {
  return value?.trim() || null;
}

export async function businessConfiguration() {
  const env = await runtimeEnvironment();
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
    github: { configured: githubConfigured, appSlug: githubSlug },
    billing: {
      configured: stripeConfigured,
      portalConfigured: Boolean(normalized(env.STRIPE_SECRET_KEY)),
    },
  };
}

export async function githubConfiguration() {
  const env = await runtimeEnvironment();
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
  const env = await runtimeEnvironment();
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
  const env = await runtimeEnvironment();
  const secretKey = normalized(env.STRIPE_SECRET_KEY);
  if (!secretKey)
    throw new Error("Stripe billing credentials are not configured");
  return { secretKey };
}
