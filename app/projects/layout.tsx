import { requireAppUser } from "@/server/current-user";

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  await requireAppUser("/dashboard");
  return children;
}
