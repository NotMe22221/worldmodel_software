import { sharedDecisionReport } from "@/db/product";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try { const { token } = await context.params; return Response.json(await sharedDecisionReport(token), { headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow" } }); }
  catch { return Response.json({ error: { code: "report_not_found", message: "Shared report was not found" } }, { status: 404 }); }
}
