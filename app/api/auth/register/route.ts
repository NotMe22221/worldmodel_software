import { createSession, registerAccount, sessionCookie } from "@/server/auth";
import { provisionCustomerWorkspace } from "@/db/saas";

export async function POST(request: Request) {
  let input: { email?: string; password?: string; displayName?: string; organizationName?: string };
  try { input = await request.json(); } catch { return Response.json({ error: "A valid JSON body is required" }, { status: 400 }); }
  try {
    const user = await registerAccount({ email: input.email || "", password: input.password || "", displayName: input.displayName || "", organizationName: input.organizationName || "" });
    await provisionCustomerWorkspace(user.email, user.organizationName);
    const session = await createSession(user.id);
    return Response.json({ user }, { status: 201, headers: { "set-cookie": sessionCookie(session.token, request) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account creation failed";
    return Response.json({ error: message }, { status: message.includes("already") ? 409 : 400 });
  }
}
