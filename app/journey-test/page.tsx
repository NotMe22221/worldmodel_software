"use client";

import { useState } from "react";

export default function CheckoutJourneyFixture() {
  const [step, setStep] = useState(1);
  const labels = ["Store", "Cart", "Payment", "Order", "Done"];
  return (
    <main className="fixture-shell">
      <header><b>Northstar Supply</b><span>WorldModel journey fixture</span></header>
      <div className="fixture-progress" aria-label="Checkout progress">{labels.map((label, index) => <span key={label} className={step >= index + 1 ? "active" : ""}>{index + 1}<small>{label}</small></span>)}</div>
      {step === 1 && <section><p className="fixture-kicker">TRAIL ESSENTIALS</p><h1>Field Notes Pack</h1><p>Weatherproof notebooks for ideas that happen outside.</p><strong>$24.00</strong><button data-testid="add-item" onClick={() => setStep(2)}>Add to cart</button></section>}
      {step === 2 && <section><p className="fixture-kicker">YOUR CART</p><h1>Ready to check out</h1><div className="fixture-line"><span>Field Notes Pack × 1</span><b>$24.00</b></div><button data-testid="open-cart" onClick={() => setStep(3)}>Checkout</button></section>}
      {step === 3 && <section><p className="fixture-kicker">SECURE CHECKOUT</p><h1>Payment details</h1><label>Email<input data-testid="email" type="email" defaultValue="demo@worldmodel.dev" /></label><label>Card<input data-testid="card" inputMode="numeric" defaultValue="4242 4242 4242 4242" /></label><button data-testid="submit-payment" onClick={() => setStep(4)}>Submit payment</button></section>}
      {step === 4 && <section><div className="fixture-spinner">✦</div><p className="fixture-kicker">PAYMENT ACCEPTED</p><h1>Create your order</h1><p>Payment is authorized. The order remains idempotent across retries.</p><button data-testid="create-order" onClick={() => setStep(5)}>Create order</button></section>}
      {step === 5 && <section data-testid="order-confirmation"><div className="fixture-check">✓</div><p className="fixture-kicker">ORDER WM-2048</p><h1>Order confirmed</h1><p>Your Field Notes Pack is queued for fulfillment.</p><strong>Journey passed · 684ms</strong></section>}
    </main>
  );
}
