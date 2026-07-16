import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sessionUser } from "./auth.ts";

export async function currentUser() {
  const values = await headers();
  const hostedEmail = values.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (hostedEmail) return { email: hostedEmail, displayName: values.get("oai-authenticated-user-full-name") || hostedEmail, organizationName: "" };
  return sessionUser(values.get("cookie"));
}

export async function requireAppUser(returnTo: string) {
  const user = await currentUser();
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  return user;
}
