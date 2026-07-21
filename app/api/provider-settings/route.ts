import { requestIdentity } from "@/server/request-identity";
import { providerSettingsMode, saveLocalProviderSettings, type ProviderInput } from "@/server/provider-settings";
import { businessConfiguration } from "@/server/runtime-config";
import { getSaasSnapshot, requireRole } from "@/db/saas";

export async function GET(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  return Response.json({ configuration: await businessConfiguration(), mode: await providerSettingsMode() });
}

export async function POST(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    requireRole(await getSaasSnapshot(email), ["owner"]);
    if (!(await providerSettingsMode()).editable) {
      return Response.json({ error: "Deployed provider credentials are managed in the Vercel project environment." }, { status: 409 });
    }
    const input = await request.json() as ProviderInput;
    await saveLocalProviderSettings(email, input);
    return Response.json({ saved: true, configuration: await businessConfiguration(), mode: await providerSettingsMode() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider settings could not be saved";
    return Response.json({ error: message }, { status: message.includes("role") ? 403 : message.includes("outside local") ? 409 : 400 });
  }
}
