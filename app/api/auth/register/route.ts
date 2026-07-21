import { AccountUnavailableError, AuthInputError, consumeAuthRateLimit, createSession, registerAccount, sessionCookie } from "../../../../server/auth.ts";
import { provisionCustomerWorkspace } from "../../../../db/saas.ts";

const NO_STORE = { "cache-control": "private, no-store, max-age=0" };

function unavailable() {
  return Response.json({ error: "Account creation is temporarily unavailable" }, { status: 503, headers: NO_STORE });
}

export async function POST(request: Request) {
  let input: { email?: string; password?: string; displayName?: string; organizationName?: string };
  try { input = await request.json(); } catch { return Response.json({ error: "A valid JSON body is required" }, { status: 400, headers: NO_STORE }); }
  let rateLimit;
  try { rateLimit = await consumeAuthRateLimit("register", input.email || "", request); }
  catch { return unavailable(); }
  if (!rateLimit.allowed) {
    return Response.json({ error: "Too many account creation attempts. Try again later." }, {
      status: 429,
      headers: { ...NO_STORE, "retry-after": String(rateLimit.retryAfter) },
    });
  }

  let user;
  try {
    user = await registerAccount({ email: input.email || "", password: input.password || "", displayName: input.displayName || "", organizationName: input.organizationName || "" });
  } catch (error) {
    if (error instanceof AuthInputError) return Response.json({ error: error.message }, { status: 400, headers: NO_STORE });
    if (error instanceof AccountUnavailableError) return Response.json({ error: error.message }, { status: 400, headers: NO_STORE });
    return unavailable();
  }

  try {
    await provisionCustomerWorkspace(user.email, user.organizationName);
    const session = await createSession(user.id);
    return Response.json({ user }, { status: 201, headers: { ...NO_STORE, "set-cookie": sessionCookie(session.token, request) } });
  } catch { return unavailable(); }
}
