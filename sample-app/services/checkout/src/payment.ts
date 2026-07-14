export async function chargePayment(orderId: string, amount: number) {
  const response = await fetch("http://payment-mock:8080/charges", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId, amount }),
  });
  if (!response.ok) throw new Error(`payment failed: ${response.status}`);
  return response.json();
}
