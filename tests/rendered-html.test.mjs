import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the WorldModel product entry", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>WorldModel for Software/);
  assert.match(html, /Break your software/);
  assert.match(html, /Start a simulation/);
  assert.match(html, /7/);
  assert.match(html, /3/);
  assert.match(html, /immutable replay/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("server-renders the executable checkout journey fixture", async () => {
  const response = await render("/journey-test");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Northstar Supply/);
  assert.match(html, /Field Notes Pack/);
  assert.match(html, /Add to cart/);
});

test("server-renders the identity-bound invitation acceptance route", async () => {
  const response = await render("/invite");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /WorldModel/);
  assert.match(html, /CHECKING INVITATION/);
});

test("server-renders the deny-by-default SaaS operator console", async () => {
  const response = await render("/operator");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /WORLDMODEL OPERATIONS/);
  assert.match(html, /Loading control plane/);
});

test("server-renders public trust, privacy, terms, security, and support disclosures", async () => {
  const expectations = new Map([
    ["/trust", /Evidence over promises/],
    ["/privacy", /Product data, explained plainly/],
    ["/terms", /Terms for controlled evaluation/],
    ["/security", /Secure defaults, reviewable evidence/],
    ["/support", /Help tied to the evidence/],
  ]);
  for (const [path, pattern] of expectations) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, pattern, path);
    assert.match(html, /Pre-commercial pilot/, path);
  }
});
