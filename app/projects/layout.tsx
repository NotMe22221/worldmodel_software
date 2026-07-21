import { requireAppUser } from "@/server/current-user";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  await requireAppUser("/dashboard");
  return children;
}
