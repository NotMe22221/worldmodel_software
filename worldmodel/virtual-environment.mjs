import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}

export async function createVirtualEnvironment({ repaired = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "worldmodel-env-"));
  const databasePath = join(root, "orders.json");
  const seedPath = join(root, "seed.json");
  const state = { paymentAvailable: true, orders: new Map(), events: [] };
  const seed = { user: { id: "test-user", email: "demo@worldmodel.dev" }, products: [{ id: "field-notes", price: 2400 }] };
  await writeFile(seedPath, JSON.stringify(seed));
  await writeFile(databasePath, "[]");

  const payment = await listen((request, response) => {
    if (request.url === "/health") return json(response, 200, { status: "healthy" });
    if (!state.paymentAvailable) return json(response, 503, { error: "provider_unavailable" });
    return json(response, 200, { status: "captured", providerId: "pay_test_2048" });
  });

  const email = await listen((request, response) => json(response, 200, { status: request.url === "/health" ? "healthy" : "queued" }));
  const worker = await listen((request, response) => json(response, 200, { status: request.url === "/health" ? "healthy" : "idle" }));

  const api = await listen(async (request, response) => {
    if (request.url === "/health") return json(response, 200, { status: "healthy" });
    if (request.url !== "/checkout" || request.method !== "POST") return json(response, 404, { error: "not_found" });
    const input = await body(request);
    if (state.orders.has(input.idempotencyKey)) return json(response, 200, state.orders.get(input.idempotencyKey));
    const paymentResponse = await fetch(`${payment.url}/charge`, { method: "POST" });
    if (!paymentResponse.ok && !repaired) {
      state.events.push({ type: "checkout_failed", reason: "payment_503" });
      return json(response, 502, { error: "checkout_failed" });
    }
    const order = { id: `order-${state.orders.size + 1}`, idempotencyKey: input.idempotencyKey, status: paymentResponse.ok ? "confirmed" : "payment_pending" };
    state.orders.set(input.idempotencyKey, order);
    await writeFile(databasePath, JSON.stringify([...state.orders.values()]));
    state.events.push({ type: "order_created", status: order.status });
    return json(response, paymentResponse.ok ? 201 : 202, order);
  });

  const storefront = await listen((request, response) => request.url === "/health" ? json(response, 200, { status: "healthy" }) : json(response, 200, { app: "demo-store" }));
  const services = { storefront, api, payment, email, worker };

  return {
    id: root.split("/").at(-1), root, seedPath, databasePath, services, state,
    async healthCheck() {
      const results = await Promise.all(Object.entries(services).map(async ([name, service]) => ({ name, ok: (await fetch(`${service.url}/health`)).ok })));
      return { passed: results.every((result) => result.ok), services: results, databaseSeeded: JSON.parse(await readFile(seedPath, "utf8")).products.length === 1 };
    },
    injectPaymentOutage() { state.paymentAvailable = false; state.events.push({ type: "fault_injected", target: "payment" }); },
    async checkout(idempotencyKey = "checkout-1") { const response = await fetch(`${api.url}/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey }) }); return { status: response.status, body: await response.json() }; },
    async reset() { state.paymentAvailable = true; state.orders.clear(); state.events.length = 0; await writeFile(databasePath, "[]"); },
    async destroy() { await Promise.all(Object.values(services).map(({ server }) => close(server))); await rm(root, { recursive: true, force: true }); },
  };
}
