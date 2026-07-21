import { requestUser } from "@/server/request-identity";
import { readBoundedRequestJson, RequestBodyTooLargeError } from "@/server/bounded-request-body";
import { providerSettingsMode, saveLocalProviderSettings, type ProviderInput } from "@/server/provider-settings";
import { businessConfiguration, hasOperatorAccess } from "@/server/runtime-config";
import { getSaasSnapshot, requireRole } from "@/db/saas";

const MAX_PROVIDER_SETTINGS_BODY_BYTES = 65_536;

export async function GET(request: Request) {
  const user = await requestUser(request);
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const mode = await providerSettingsMode();
  if (mode.editable) {
    try {
      requireRole(await getSaasSnapshot(user.email), ["owner"]);
    } catch {
      return Response.json({ error: "Workspace owner access required" }, { status: 403 });
    }
  } else if (!(await hasOperatorAccess(user.email, user.id))) {
    return Response.json({ error: "Platform operator access required" }, { status: 403 });
  }
  return Response.json(
    { configuration: await businessConfiguration(), mode },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const user = await requestUser(request);
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    const mode = await providerSettingsMode();
    if (!mode.editable && !(await hasOperatorAccess(user.email, user.id))) {
      return Response.json({ error: "Platform operator access required" }, { status: 403 });
    }
    requireRole(await getSaasSnapshot(user.email), ["owner"]);
    if (!mode.editable) {
      return Response.json({ error: "Deployed provider credentials are managed in the Vercel project environment." }, { status: 409 });
    }
    const input = await readBoundedRequestJson<ProviderInput>(request, MAX_PROVIDER_SETTINGS_BODY_BYTES);
    await saveLocalProviderSettings(user.email, input);
    return Response.json({ saved: true, configuration: await businessConfiguration(), mode: await providerSettingsMode() });
  } catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError;
    const message = tooLarge ? "Request body exceeds 64 KB" : error instanceof Error ? error.message : "Provider settings could not be saved";
    return Response.json({ error: message }, { status: tooLarge ? 413 : message.includes("role") ? 403 : message.includes("outside local") ? 409 : 400 });
  }
}
