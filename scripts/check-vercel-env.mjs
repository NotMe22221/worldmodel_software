const storageVariables = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"];

function validateDeploymentOrigin(value, allowHostname) {
  const configured = value.trim();
  let origin;
  try {
    origin = new URL(allowHostname && !configured.includes("://") ? `https://${configured}` : configured);
  } catch {
    throw new Error("The deployment origin must be a canonical HTTPS origin without credentials, a path, query, or fragment.");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("The deployment origin must be a canonical HTTPS origin without credentials, a path, query, or fragment.");
  }
}

if (process.env.VERCEL !== "1" || !["production", "preview"].includes(process.env.VERCEL_ENV || "")) {
  throw new Error(
    "Vercel system environment variables are unavailable. Enable Automatically expose System Environment Variables for this project before deploying.",
  );
}

const unsafeLocalFlags = ["WORLDMODEL_LOCAL_RUNTIME", "LOCAL_DEVELOPMENT", "COMPOSIO_FIXTURE_MODE"]
  .filter((key) => process.env[key] === "true");
if (unsafeLocalFlags.length) {
  throw new Error(`Vercel cannot run with local-only flags enabled: ${unsafeLocalFlags.join(", ")}. Remove them from the deployment environment.`);
}
const runnerTokenSecret = process.env.RUNNER_TOKEN_SECRET?.trim();
if (runnerTokenSecret && new TextEncoder().encode(runnerTokenSecret).byteLength < 32) {
  throw new Error("RUNNER_TOKEN_SECRET must contain at least 32 UTF-8 bytes. Generate a new value with `openssl rand -hex 32`.");
}
const missingStorage = storageVariables.filter((key) => !process.env[key]?.trim());
if (missingStorage.length) {
  const message = `Vercel Turso storage is not configured. Missing: ${missingStorage.join(", ")}. Connect Turso to this Vercel project before deploying.`;
  if (process.env.VERCEL_ENV === "production") throw new Error(message);
  console.warn(`${message} Preview data-backed routes and /api/health will be unavailable.`);
} else {
  console.log("Vercel durable storage preflight passed.");
}

const explicitOrigin = process.env.WORLDMODEL_PUBLIC_ORIGIN?.trim();
const systemOrigin = process.env.VERCEL_ENV === "production"
  ? process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  : process.env.VERCEL_URL?.trim();
if (explicitOrigin) {
  validateDeploymentOrigin(explicitOrigin, false);
  console.log("WorldModel canonical deployment origin override detected.");
} else if (systemOrigin) {
  validateDeploymentOrigin(systemOrigin, true);
  console.log("Vercel canonical deployment origin detected.");
} else {
  throw new Error(
    "No canonical deployment origin is available. Enable Vercel system environment variables or set WORLDMODEL_PUBLIC_ORIGIN.",
  );
}
