import { requireAppUser } from "@/server/current-user";
export default async function SettingsLayout({ children }: { children: React.ReactNode }) { await requireAppUser("/settings/providers"); return children; }
