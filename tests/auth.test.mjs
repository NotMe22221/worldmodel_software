import assert from "node:assert/strict";
import test from "node:test";

process.env.WORLDMODEL_LOCAL_RUNTIME = "true";

test("Next applies baseline security headers without advertising its framework", async () => {
  const { default: config } = await import("../next.config.ts");
  assert.equal(config.poweredByHeader, false);
  const rules = await config.headers();
  const headers = new Map(rules[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(headers.get("strict-transport-security") || "", /max-age=63072000/);
  assert.match(headers.get("permissions-policy") || "", /camera=\(\)/);
});

test("accounts use hashed credentials and revocable sessions", async () => {
  const { registerAccount, authenticateAccount, createSession, destroySession, sessionUser } = await import("../server/auth.ts");
  const unique = crypto.randomUUID().replaceAll("-", "");
  const email = `auth.${unique}@worldmodel.test`;
  const password = "Strong-Test-Password-2026!";
  const registered = await registerAccount({ email, password, displayName: "Auth Test", organizationName: "WorldModel QA" });
  assert.equal(registered.email, email);
  await assert.rejects(() => authenticateAccount(email, "wrong-password"), /incorrect/);
  const authenticated = await authenticateAccount(email, password);
  assert.equal(authenticated.id, registered.id);
  const session = await createSession(registered.id);
  assert.equal((await sessionUser(`wm_session=${session.token}`))?.email, email);
  await destroySession(session.token);
  assert.equal(await sessionUser(`wm_session=${session.token}`), null);
});

test("session parsing rejects malformed cookies without throwing", async () => {
  const { sessionToken, sessionUser } = await import("../server/auth.ts");
  const malformed = "wm_session=%E0%A4%A";
  assert.equal(sessionToken(new Request("https://worldmodel.test", { headers: { cookie: malformed } })), null);
  assert.equal(await sessionUser(malformed), null);
  assert.equal(sessionToken(new Request("https://worldmodel.test", { headers: { cookie: "wm_session_without_value" } })), null);
});

test("reading a session does not write last_seen_at", async () => {
  const { registerAccount, createSession, sessionUser } = await import("../server/auth.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  const unique = crypto.randomUUID().replaceAll("-", "");
  const registered = await registerAccount({
    email: `read.${unique}@worldmodel.test`,
    password: "Strong-Test-Password-2026!",
    displayName: "Read Test",
    organizationName: "WorldModel QA",
  });
  const session = await createSession(registered.id);
  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);
  await db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE user_id = ?").bind("2000-01-01T00:00:00.000Z", registered.id).run();
  assert.equal((await sessionUser(`wm_session=${session.token}`))?.email, registered.email);
  const stored = await db.prepare("SELECT last_seen_at FROM auth_sessions WHERE user_id = ?").bind(registered.id).first();
  assert.equal(stored?.last_seen_at, "2000-01-01T00:00:00.000Z");
});

test("session API responses are private and never cached", async () => {
  const { registerAccount, createSession } = await import("../server/auth.ts");
  const { GET } = await import("../app/api/auth/session/route.ts");
  const unique = crypto.randomUUID().replaceAll("-", "");
  const registered = await registerAccount({
    email: `route.${unique}@worldmodel.test`,
    password: "Strong-Test-Password-2026!",
    displayName: "Route Test",
    organizationName: "WorldModel QA",
  });
  const session = await createSession(registered.id);

  const authenticated = await GET(new Request("https://worldmodel.test/api/auth/session", {
    headers: { cookie: `wm_session=${session.token}` },
  }));
  assert.equal(authenticated.status, 200);
  assert.match(authenticated.headers.get("cache-control") || "", /private/);
  assert.match(authenticated.headers.get("cache-control") || "", /no-store/);
  assert.equal(authenticated.headers.get("vary"), "Cookie");
  assert.equal((await authenticated.json()).user.email, registered.email);

  const unauthenticated = await GET(new Request("https://worldmodel.test/api/auth/session", {
    headers: { cookie: "wm_session=%E0%A4%A" },
  }));
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get("cache-control") || "", /no-store/);
  assert.deepEqual(await unauthenticated.json(), { authenticated: false });
});

test("registration rejects weak passwords and malformed emails", async () => {
  const { registerAccount } = await import("../server/auth.ts");
  await assert.rejects(() => registerAccount({ email: "not-an-email", password: "short", displayName: "QA", organizationName: "QA Org" }), /valid business email/);
});

test("public identity headers cannot bypass session authentication", async () => {
  const { registerAccount, createSession } = await import("../server/auth.ts");
  const { requestUser, requestIdentity } = await import("../server/request-identity.ts");
  const unique = crypto.randomUUID().replaceAll("-", "");
  const email = `session.${unique}@worldmodel.test`;
  const registered = await registerAccount({ email, password: "Strong-Test-Password-2026!", displayName: "Session Test", organizationName: "WorldModel QA" });

  const forged = new Request("https://worldmodel.test/api/auth/session", {
    headers: {
      "oai-authenticated-user-email": "attacker@worldmodel.test",
      "oai-authenticated-user-full-name": "Forged User",
    },
  });
  assert.equal(await requestUser(forged), null);
  assert.equal(await requestIdentity(forged), null);

  const session = await createSession(registered.id);
  const authenticated = new Request("https://worldmodel.test/api/auth/session", {
    headers: {
      cookie: `wm_session=${session.token}`,
      "oai-authenticated-user-email": "attacker@worldmodel.test",
    },
  });
  assert.equal((await requestUser(authenticated))?.email, email);
  assert.equal(await requestIdentity(authenticated), email);
});

test("authentication return paths stay on the application origin", async () => {
  const { safeReturnPath } = await import("../app/safe-return.ts");
  assert.equal(safeReturnPath("/invite?token=abc#accept"), "/invite?token=abc#accept");
  assert.equal(safeReturnPath("https://evil.example/steal"), "/dashboard");
  assert.equal(safeReturnPath("//evil.example/steal"), "/dashboard");
  assert.equal(safeReturnPath("/\\evil.example/steal"), "/dashboard");
  assert.equal(safeReturnPath("not-a-path"), "/dashboard");
});

test("auth abuse windows use bounded hashed email buckets and trust only Vercel IPs", async () => {
  const { consumeAuthRateLimit, trustedRequestIp } = await import("../server/auth.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  const previousVercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    const ip = "2001:db8::1";
    const request = new Request("https://worldmodel.test/api/auth/login", { headers: { "x-vercel-forwarded-for": ip } });
    assert.equal(trustedRequestIp(request), ip);
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }

  const marker = crypto.randomUUID().replaceAll("-", "");
  const email = `Rate.${marker}@WorldModel.Test`;
  const request = new Request("https://worldmodel.test/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.200", "x-vercel-forwarded-for": "2001:db8::1" },
  });
  assert.equal(trustedRequestIp(request), null);

  const now = 2_000_000_000;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    assert.deepEqual(await consumeAuthRateLimit("login", email, request, now), { allowed: true });
  }
  assert.deepEqual(await consumeAuthRateLimit("login", email.toLowerCase(), request, now), { allowed: false, retryAfter: 900 });
  assert.deepEqual(await consumeAuthRateLimit("login", email, request, now + 901), { allowed: true });

  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);
  const rows = await db.prepare("SELECT bucket_hash, action, scope, attempt_count FROM auth_rate_limits WHERE window_started_at IN (?, ?) AND action = 'login'").bind(now, now + 901).all();
  assert.equal(rows.results.length, 1);
  for (const row of rows.results) {
    assert.match(String(row.bucket_hash), /^[a-f0-9]{64}$/);
    assert.equal(row.scope, "email");
  }
  const stored = JSON.stringify(rows.results);
  assert.doesNotMatch(stored, new RegExp(marker, "i"));
  assert.doesNotMatch(stored, /2001:db8|198\.51\.100\.200/i);
});

test("login responses resist enumeration, throttle failures, and relax account buckets after success", async () => {
  const { registerAccount } = await import("../server/auth.ts");
  const { POST } = await import("../app/api/auth/login/route.ts");
  const marker = crypto.randomUUID().replaceAll("-", "");
  const email = `login.${marker}@worldmodel.test`;
  const password = "Strong-Test-Password-2026!";
  await registerAccount({ email, password, displayName: "Login Test", organizationName: "WorldModel QA" });
  const request = (targetEmail, targetPassword, ip) => new Request("https://worldmodel.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-vercel-forwarded-for": ip },
    body: JSON.stringify({ email: targetEmail, password: targetPassword }),
  });

  const known = await POST(request(email, "incorrect-password", "203.0.113.21"));
  const unknown = await POST(request(`unknown.${marker}@worldmodel.test`, "incorrect-password", "203.0.113.22"));
  assert.equal(known.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await known.json(), await unknown.json());

  for (let attempt = 1; attempt < 15; attempt += 1) {
    assert.equal((await POST(request(email, "incorrect-password", "203.0.113.21"))).status, 401);
  }
  const blocked = await POST(request(email, "incorrect-password", "203.0.113.21"));
  assert.equal(blocked.status, 429);
  assert.match(blocked.headers.get("retry-after") || "", /^\d+$/);
  assert.match(blocked.headers.get("cache-control") || "", /no-store/);
  assert.equal(blocked.headers.get("set-cookie"), null);

  const recoveryEmail = `recovery.${marker}@worldmodel.test`;
  await registerAccount({ email: recoveryEmail, password, displayName: "Recovery Test", organizationName: "WorldModel QA" });
  for (let attempt = 0; attempt < 14; attempt += 1) {
    assert.equal((await POST(request(recoveryEmail, "incorrect-password", "203.0.113.23"))).status, 401);
  }
  const success = await POST(request(recoveryEmail.toUpperCase(), password, "203.0.113.23"));
  assert.equal(success.status, 200);
  assert.match(success.headers.get("set-cookie") || "", /wm_session=/);
  assert.equal((await POST(request(recoveryEmail, "incorrect-password", "203.0.113.23"))).status, 401);
});

test("registration throttling is durable without storing raw identifiers", async () => {
  const { consumeAuthRateLimit, registerAccount } = await import("../server/auth.ts");
  const { POST } = await import("../app/api/auth/register/route.ts");
  const marker = crypto.randomUUID().replaceAll("-", "");
  const email = `register.${marker}@worldmodel.test`;
  const directHeaders = { "content-type": "application/json", "x-vercel-forwarded-for": "203.0.113.24" };
  const request = new Request("https://worldmodel.test/api/auth/register", { headers: directHeaders });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.deepEqual(await consumeAuthRateLimit("register", email, request, 2_100_000_000), { allowed: true });
  }
  assert.deepEqual(await consumeAuthRateLimit("register", email.toUpperCase(), request, 2_100_000_000), { allowed: false, retryAfter: 3_600 });

  const currentEmail = `current.${marker}@worldmodel.test`;
  const routeHeaders = { "content-type": "application/json", "x-vercel-forwarded-for": "203.0.113.25" };
  const currentRequest = new Request("https://worldmodel.test/api/auth/register", { headers: routeHeaders });
  for (let attempt = 0; attempt < 4; attempt += 1) await consumeAuthRateLimit("register", currentEmail, currentRequest);
  const blocked = await POST(new Request("https://worldmodel.test/api/auth/register", {
    method: "POST",
    headers: routeHeaders,
    body: JSON.stringify({ email: currentEmail, password: "Strong-Test-Password-2026!", displayName: "Rate Test", organizationName: "WorldModel QA" }),
  }));
  assert.equal(blocked.status, 429);
  assert.match(blocked.headers.get("retry-after") || "", /^\d+$/);
  assert.match(blocked.headers.get("cache-control") || "", /no-store/);

  const existingEmail = `existing.${marker}@worldmodel.test`;
  await registerAccount({ email: existingEmail, password: "Strong-Test-Password-2026!", displayName: "Existing Test", organizationName: "WorldModel QA" });
  const existing = await POST(new Request("https://worldmodel.test/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-vercel-forwarded-for": "203.0.113.26" },
    body: JSON.stringify({ email: existingEmail, password: "Strong-Test-Password-2026!", displayName: "Existing Test", organizationName: "WorldModel QA" }),
  }));
  assert.equal(existing.status, 400);
  assert.deepEqual(await existing.json(), { error: "Unable to create account with those details" });
});
