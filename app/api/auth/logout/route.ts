import { clearSessionCookie, destroySession, sessionToken } from "@/server/auth";

export async function POST(request: Request) {
  await destroySession(sessionToken(request));
  return Response.json({ signedOut: true }, { headers: { "set-cookie": clearSessionCookie(request) } });
}
