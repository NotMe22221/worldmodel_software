import { apiScopes, createApiKey, revokeApiKey } from "@/db/developer-api";
import { requestIdentity } from "@/server/request-identity";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "API key could not be updated";
  const status = message.includes("role") ? 403 : message.includes("plan") || message.includes("Payment") ? 402 : message.includes("limit") ? 409 : message.includes("not found") ? 404 : message.includes("scope") ? 400 : 500;
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { action?: string; name?: string; scopes?: string[]; expirationDays?: number | null; keyId?: string };
  try { payload = await request.json(); }
  catch { return Response.json({ error: "A valid JSON request body is required" }, { status: 400 }); }
  if (payload.action === "create") {
    const name = payload.name?.trim();
    const scopes = Array.isArray(payload.scopes) ? payload.scopes : [];
    const expirationDays = payload.expirationDays === null ? null : Number(payload.expirationDays);
    if (!name || name.length > 80) return Response.json({ error: "A key name under 80 characters is required" }, { status: 400 });
    if (!scopes.length || scopes.some((scope) => !apiScopes.includes(scope as typeof apiScopes[number]))) return Response.json({ error: "Choose supported API scopes" }, { status: 400 });
    if (expirationDays !== null && ![30, 90, 365].includes(expirationDays)) return Response.json({ error: "Choose a supported expiration period" }, { status: 400 });
    try { return Response.json(await createApiKey(email, { name, scopes, expirationDays }), { status: 201 }); }
    catch (error) { return failure(error); }
  }
  if (payload.action === "revoke") {
    const keyId = payload.keyId?.trim();
    if (!keyId || keyId.length > 80) return Response.json({ error: "A valid API key is required" }, { status: 400 });
    try { return Response.json({ key: await revokeApiKey(email, keyId) }); }
    catch (error) { return failure(error); }
  }
  return Response.json({ error: "Choose create or revoke" }, { status: 400 });
}
