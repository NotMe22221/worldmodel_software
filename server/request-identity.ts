import { sessionUser } from "./auth.ts";

export async function requestUser(request: Request) {
  const hostedEmail = request.headers
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  if (hostedEmail) {
    return {
      email: hostedEmail,
      displayName:
        request.headers.get("oai-authenticated-user-full-name")?.trim() ||
        hostedEmail.split("@")[0],
      organizationName: "",
    };
  }
  return sessionUser(request.headers.get("cookie"));
}

export async function requestIdentity(request: Request) {
  return (await requestUser(request))?.email || null;
}
