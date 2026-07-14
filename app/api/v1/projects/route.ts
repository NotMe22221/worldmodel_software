import { ApiAccessError, authenticateApiRequest, listApiProjects } from "@/db/developer-api";

export async function GET(request: Request) {
  try {
    const context = await authenticateApiRequest(request, "projects:read");
    return Response.json({ data: await listApiProjects(context.workspaceId) }, { headers: context.rateHeaders });
  } catch (error) {
    if (error instanceof ApiAccessError) return Response.json({ error: { code: error.status === 429 ? "rate_limit_exceeded" : error.status === 403 ? "insufficient_scope" : "unauthorized", message: error.message } }, { status: error.status, headers: error.headers });
    return Response.json({ error: { code: "internal_error", message: "Projects could not be loaded" } }, { status: 500 });
  }
}
