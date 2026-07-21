import { authenticateAccount, consumeAuthRateLimit, createSession, InvalidCredentialsError, relaxSuccessfulLoginRateLimit, sessionCookie } from "../../../../server/auth.ts";
import { readBoundedRequestJson, RequestBodyTooLargeError } from "../../../../server/bounded-request-body.ts";

const NO_STORE = { "cache-control": "private, no-store, max-age=0" };

function unavailable() {
  return Response.json({ error: "Sign in is temporarily unavailable" }, { status: 503, headers: NO_STORE });
}

export async function POST(request: Request) {
  let input: { email?: string; password?: string };
  try { input = await readBoundedRequestJson(request, 8_192); }
  catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError;
    return Response.json({ error: tooLarge ? "Request body exceeds 8 KB" : "A valid JSON body is required" }, { status: tooLarge ? 413 : 400, headers: NO_STORE });
  }
  let rateLimit;
  try { rateLimit = await consumeAuthRateLimit("login", input.email || "", request); }
  catch { return unavailable(); }
  if (!rateLimit.allowed) {
    return Response.json({ error: "Too many authentication attempts. Try again later." }, {
      status: 429,
      headers: { ...NO_STORE, "retry-after": String(rateLimit.retryAfter) },
    });
  }

  let user;
  try {
    user = await authenticateAccount(input.email || "", input.password || "");
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return Response.json({ error: "Email or password is incorrect" }, { status: 401, headers: NO_STORE });
    }
    return unavailable();
  }

  try {
    await relaxSuccessfulLoginRateLimit(input.email || "", request);
    const session = await createSession(user.id);
    return Response.json({ user }, { headers: { ...NO_STORE, "set-cookie": sessionCookie(session.token, request) } });
  } catch { return unavailable(); }
}
