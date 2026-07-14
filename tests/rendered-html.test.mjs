import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the WorldModel command center", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>WorldModel for Software/);
  assert.match(html, /Checkout resilience/);
  assert.match(html, /Traffic spike/);
  assert.match(html, /Database slowdown/);
  assert.match(html, /Payment outage/);
  assert.match(html, /Run simulation/);
  assert.match(html, /Complete checkout/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
