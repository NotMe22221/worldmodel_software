import { sessionUser } from "../../../../server/auth.ts";

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};

export async function GET(request: Request) {
  const user = await sessionUser(request.headers.get("cookie"));
  if (!user) return Response.json({ authenticated: false }, { status: 401, headers: privateResponseHeaders });
  return Response.json({ authenticated: true, user }, { headers: privateResponseHeaders });
}
