const storageVariables = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"];

if (process.env.VERCEL === "1") {
  const unsafeLocalFlags = ["WORLDMODEL_LOCAL_RUNTIME", "LOCAL_DEVELOPMENT", "COMPOSIO_FIXTURE_MODE"]
    .filter((key) => process.env[key] === "true");
  if (unsafeLocalFlags.length) {
    throw new Error(`Vercel cannot run with local-only flags enabled: ${unsafeLocalFlags.join(", ")}. Remove them from the deployment environment.`);
  }
  const missingStorage = storageVariables.filter((key) => !process.env[key]?.trim());
  if (missingStorage.length) {
    const message = `Vercel Turso storage is not configured. Missing: ${missingStorage.join(", ")}. Connect Turso to this Vercel project before deploying.`;
    if (process.env.VERCEL_ENV === "production") throw new Error(message);
    console.warn(`${message} Preview data-backed routes and /api/health will be unavailable.`);
  } else {
    console.log("Vercel durable storage preflight passed.");
  }

  if (process.env.VERCEL_ENV === "production" && !process.env.WORLDMODEL_PUBLIC_ORIGIN?.trim()) {
    console.warn(
      "WORLDMODEL_PUBLIC_ORIGIN is not set. Request-derived origins will be used until a canonical production URL is configured.",
    );
  }
}
