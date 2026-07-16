import { authenticateAccount, createSession, sessionCookie } from "@/server/auth";

export async function POST(request: Request) {
  let input: { email?: string; password?: string };
  try { input = await request.json(); } catch { return Response.json({ error: "A valid JSON body is required" }, { status: 400 }); }
  try {
    const user = await authenticateAccount(input.email || "", input.password || "");
    const session = await createSession(user.id);
    return Response.json({ user }, { headers: { "set-cookie": sessionCookie(session.token, request) } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Sign in failed" }, { status: 401 });
  }
}
