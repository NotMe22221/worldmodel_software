import { requestIdentity } from "@/server/request-identity";
import { sessionUser } from "@/server/auth";

export async function GET(request: Request) {
  const email = await requestIdentity(request);
  if (!email) return Response.json({ authenticated: false }, { status: 401 });
  const user = await sessionUser(request.headers.get("cookie"));
  return Response.json({ authenticated: true, user: user || { email, displayName: email, organizationName: "" } });
}
