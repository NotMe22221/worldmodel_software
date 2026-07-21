import { sessionUser } from "./auth.ts";

export async function requestUser(request: Request) {
  return sessionUser(request.headers.get("cookie"));
}

export async function requestIdentity(request: Request) {
  return (await requestUser(request))?.email || null;
}
