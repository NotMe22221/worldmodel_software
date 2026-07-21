import assert from "node:assert/strict";
import test from "node:test";

process.env.WORLDMODEL_LOCAL_RUNTIME = "true";

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
