import { exportWorkspaceData } from "@/db/operations";
import { requestIdentity } from "@/server/request-identity";

export async function GET(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    const payload = await exportWorkspaceData(email);
    return new Response(JSON.stringify(payload, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": "attachment; filename=worldmodel-data-export.json", "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Data export could not be created" }, { status: 500 });
  }
}
