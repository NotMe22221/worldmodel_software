import { requireAppUser } from "@/server/current-user";
import { providerSettingsMode } from "@/server/provider-settings";
import { hasOperatorAccess } from "@/server/runtime-config";
import { getSaasSnapshot } from "@/db/saas";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAppUser("/settings/providers");
  const [mode, operatorAccess] = await Promise.all([
    providerSettingsMode(),
    hasOperatorAccess(user.email, user.id),
  ]);
  const localOwner = mode.editable
    ? (await getSaasSnapshot(user.email)).workspace.membership_role === "owner"
    : false;
  if ((mode.editable && !localOwner) || (!mode.editable && !operatorAccess)) {
    redirect("/dashboard?tab=integrations");
  }
  return children;
}
