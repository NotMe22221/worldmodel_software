import { getSimulationReport } from "../../../db/saas";
import { formatVerificationReport } from "../../../worldmodel/verification-report.mjs";

function identity(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email");
  if (email) return email;
  const host = new URL(request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") return "demo@worldmodel.dev";
  return null;
}

export async function GET(request: Request) {
  const email = identity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const runId = new URL(request.url).searchParams.get("run");
  if (!runId) return Response.json({ error: "A report run is required" }, { status: 400 });
  try {
    const run = await getSimulationReport(email, runId);
    const report = formatVerificationReport(run);
    return new Response(report, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="worldmodel-${runId}-report.txt"`, "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate report";
    return Response.json({ error: message }, { status: message.includes("after") ? 409 : 404 });
  }
}
