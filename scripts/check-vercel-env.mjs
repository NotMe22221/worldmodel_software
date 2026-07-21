const storageVariables = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_D1_DATABASE_ID", "CLOUDFLARE_D1_API_TOKEN"];

if (process.env.VERCEL === "1") {
  const missingStorage = storageVariables.filter((key) => !process.env[key]?.trim());
  if (missingStorage.length) {
    console.warn(
      `Vercel durable storage is not configured. Missing: ${missingStorage.join(", ")}. ` +
      "The build will continue so public pages can deploy; data-backed routes and /api/health remain unavailable until storage is configured.",
    );
  } else {
    console.log("Vercel durable storage preflight passed.");
  }

  if (process.env.VERCEL_ENV === "production" && !process.env.WORLDMODEL_PUBLIC_ORIGIN?.trim()) {
    console.warn(
      "WORLDMODEL_PUBLIC_ORIGIN is not set. Request-derived origins will be used until a canonical production URL is configured.",
    );
  }
}
