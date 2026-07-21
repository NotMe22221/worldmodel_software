import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sessionUser } from "./auth.ts";

export async function currentUser() {
  const values = await headers();
  return sessionUser(values.get("cookie"));
}

export async function requireAppUser(returnTo: string) {
  const user = await currentUser();
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  return user;
}
