export type RuntimeRunResult = {
  success?: boolean;
  meta: { changes: number; last_row_id: number | string };
};

export type RuntimeStatement = {
  bind(...values: unknown[]): RuntimeStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] } & Record<string, unknown>>;
  run(): Promise<RuntimeRunResult>;
};

export type RuntimeDatabase = {
  prepare(sql: string): RuntimeStatement;
  batch(statements: RuntimeStatement[]): Promise<RuntimeRunResult[]>;
};

export type RuntimeArtifact = {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};

export type RuntimeArtifactStore = {
  put(key: string, value: string | ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<RuntimeArtifact | null>;
};

export type RuntimeEnv = Record<string, unknown> & {
  DB?: RuntimeDatabase;
  ARTIFACTS?: RuntimeArtifactStore;
};

export function isLocalDevelopmentEnvironment(env: Record<string, unknown>) {
  return env.LOCAL_DEVELOPMENT === "true" &&
    env.VERCEL !== "1" &&
    env.VERCEL_RUNTIME !== "true";
}

export async function getRuntimeEnv(): Promise<RuntimeEnv> {
  if (process.env.VERCEL === "1") {
    return (await import("./vercel-runtime.ts")).vercelRuntimeEnv() as unknown as RuntimeEnv;
  }
  const localRequested = process.env.NODE_ENV === "development" || process.env.WORLDMODEL_LOCAL_RUNTIME === "true";
  if (localRequested && process.env.NODE_ENV !== "production") {
    return await (await import("./local-runtime.ts")).localRuntimeEnv() as RuntimeEnv;
  }
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    return (await import("./vercel-runtime.ts")).vercelRuntimeEnv() as unknown as RuntimeEnv;
  }
  throw new Error("RUNTIME_NOT_CONFIGURED: Use the local runtime for development or configure Turso for the Vercel runtime");
}
