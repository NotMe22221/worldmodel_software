import { getRuntimeEnv, isLocalDevelopmentEnvironment } from "./runtime-env.ts";

export async function publicRequestOrigin(request: Request) {
  const env = await getRuntimeEnv();
  const internal = new URL(request.url);
  const localDevelopment = isLocalDevelopmentEnvironment(env);
  if (localDevelopment && internal.protocol === "http:" && ["127.0.0.1", "localhost"].includes(internal.hostname)) return internal.origin;
  const configured = String(env.WORLDMODEL_PUBLIC_ORIGIN || "").trim();
  if (configured) {
    const origin = new URL(configured);
    const local = localDevelopment && origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname);
    if (origin.protocol !== "https:" && !local) throw new Error("WorldModel public origin is not allowed");
    return origin.origin;
  }
  if (!localDevelopment) return internal.origin;
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim();
  if (/^(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(host)) return `http://${host}`;
  return internal.origin;
}
