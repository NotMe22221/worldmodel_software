import { requireAppUser } from "@/server/current-user";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAppUser("/dashboard");
  return children;
}
