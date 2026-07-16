const required = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_D1_DATABASE_ID", "CLOUDFLARE_D1_API_TOKEN"];

if (process.env.VERCEL === "1") {
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (process.env.VERCEL_ENV === "production" && !process.env.WORLDMODEL_PUBLIC_ORIGIN?.trim()) missing.push("WORLDMODEL_PUBLIC_ORIGIN");
  if (missing.length) {
    console.error(`Vercel deployment configuration is incomplete. Missing: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("Vercel deployment environment preflight passed.");
}
