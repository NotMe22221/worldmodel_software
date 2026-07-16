import { getRuntimeEnv } from "@/server/runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const env = await getRuntimeEnv();
    const database = env.DB;
    if (!database) throw new Error("Database binding is unavailable");
    const probe = await database.prepare("SELECT 1 AS ready").first<{ ready: number }>();
    if (Number(probe?.ready) !== 1) throw new Error("Database probe returned an invalid response");
    const platform = process.env.VERCEL === "1" ? "vercel" : process.env.WORLDMODEL_LOCAL_RUNTIME === "true" || process.env.NODE_ENV === "development" ? "local" : "cloudflare";
    return Response.json({ status: "ok", storage: "durable", platform }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Deployment health check failed", error instanceof Error ? error.message : error);
    return Response.json({ status: "unavailable", storage: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
