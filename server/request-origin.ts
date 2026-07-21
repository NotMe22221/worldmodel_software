import { getRuntimeEnv, isLocalDevelopmentEnvironment } from "./runtime-env.ts";

const localHostnames = new Set(["127.0.0.1", "localhost"]);

function validatedOrigin(value: string, allowLocalHttp = false) {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("WorldModel public origin is not allowed");
  }
  const local = allowLocalHttp && origin.protocol === "http:" && localHostnames.has(origin.hostname);
  if (
    (origin.protocol !== "https:" && !local) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("WorldModel public origin is not allowed");
  }
  return origin.origin;
}

export function vercelProjectProductionOrigin(value: unknown) {
  const configured = String(value || "").trim();
  if (!configured) return null;
  return validatedOrigin(configured.includes("://") ? configured : `https://${configured}`);
}

export function vercelSystemDeploymentOrigin(env: Record<string, unknown>) {
  const environment = String(env.VERCEL_ENV || "").trim();
  if (environment === "production") return vercelProjectProductionOrigin(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (environment === "preview") return vercelProjectProductionOrigin(env.VERCEL_URL);
  return null;
}

export function resolvePublicRequestOrigin(request: Request, env: Record<string, unknown>) {
  const internal = new URL(request.url);
  const localDevelopment = isLocalDevelopmentEnvironment(env);
  if (localDevelopment && internal.protocol === "http:" && localHostnames.has(internal.hostname)) return internal.origin;
  const configured = String(env.WORLDMODEL_PUBLIC_ORIGIN || "").trim();
  if (configured) return validatedOrigin(configured, localDevelopment);
  const vercelRuntime = env.VERCEL === "1" || env.VERCEL_RUNTIME === "true";
  if (vercelRuntime) {
    const vercelOrigin = vercelSystemDeploymentOrigin(env);
    if (vercelOrigin) return vercelOrigin;
    throw new Error("WorldModel public origin is not configured");
  }
  if (!localDevelopment) return internal.origin;
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim();
  if (/^(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(host)) return `http://${host}`;
  return internal.origin;
}

export async function publicRequestOrigin(request: Request) {
  return resolvePublicRequestOrigin(request, await getRuntimeEnv());
}
