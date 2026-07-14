import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { createVirtualEnvironment } from "../worldmodel/virtual-environment.mjs";

test("disposable lab starts, seeds, injects failure, resets, and cleans up", async () => {
  const environment = await createVirtualEnvironment();
  const root = environment.root;
  try {
    const health = await environment.healthCheck();
    assert.equal(health.passed, true);
    assert.equal(health.databaseSeeded, true);
    assert.equal(health.services.length, 5);
    assert.equal((await environment.checkout("baseline-1")).status, 201);
    environment.injectPaymentOutage();
    assert.equal((await environment.checkout("failure-1")).status, 502);
    await environment.reset();
    assert.equal(environment.state.orders.size, 0);
    assert.equal((await environment.checkout("recovered-1")).status, 201);
  } finally {
    await environment.destroy();
  }
  await assert.rejects(access(root));
});

test("repaired lab survives identical outage without duplicate orders", async () => {
  const environment = await createVirtualEnvironment({ repaired: true });
  try {
    assert.equal((await environment.healthCheck()).passed, true);
    environment.injectPaymentOutage();
    const first = await environment.checkout("immutable-order-1");
    const replay = await environment.checkout("immutable-order-1");
    assert.equal(first.status, 202);
    assert.equal(first.body.status, "payment_pending");
    assert.equal(replay.body.id, first.body.id);
    assert.equal(environment.state.orders.size, 1);
  } finally {
    await environment.destroy();
  }
});
