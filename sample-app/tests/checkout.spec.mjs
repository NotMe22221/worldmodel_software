import assert from "node:assert/strict";
import test from "node:test";
import { createVirtualEnvironment } from "../../worldmodel/virtual-environment.mjs";

test("Codex repair returns payment_pending once for an unavailable provider", async () => {
  const environment = await createVirtualEnvironment({ repaired: true });
  try {
    environment.injectPaymentOutage();
    const first = await environment.checkout("codex-regression-order");
    const retry = await environment.checkout("codex-regression-order");
    assert.equal(first.status, 202);
    assert.equal(first.body.status, "payment_pending");
    assert.equal(retry.body.id, first.body.id);
    assert.equal(environment.state.orders.size, 1);
  } finally {
    await environment.destroy();
  }
});
