export type RuntimeEnv = Record<string, unknown> & {
  DB?: D1Database;
  ARTIFACTS?: R2Bucket;
};

export async function getRuntimeEnv(): Promise<RuntimeEnv> {
  if (process.env.NODE_ENV === "development" || process.env.WORLDMODEL_LOCAL_RUNTIME === "true") {
    return await (await import("./local-runtime.ts")).localRuntimeEnv() as RuntimeEnv;
  }
  const { env } = await import("cloudflare:workers");
  return env as unknown as RuntimeEnv;
}
