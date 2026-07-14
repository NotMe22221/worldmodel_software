import { getAuditRows } from "@/db/operations";
import { requestIdentity } from "@/server/request-identity";
import { safeCsvCell } from "@/worldmodel/safe-csv.mjs";

export async function GET(request: Request) {
  const email = requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    const rows = await getAuditRows(email);
    const header = ["event_id", "timestamp", "actor", "action", "target_type", "target_id", "summary"];
    const csv = [header.map(safeCsvCell).join(","), ...rows.map((row) => [row.id, row.created_at, row.actor_email, row.action, row.target_type, row.target_id, row.summary].map(safeCsvCell).join(","))].join("\r\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=worldmodel-audit-log.csv", "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit export could not be created";
    return Response.json({ error: message }, { status: message.includes("role") ? 403 : 500 });
  }
}
