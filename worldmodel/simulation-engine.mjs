import { createHash } from "node:crypto";

export const immutableScenario = Object.freeze({
  id: "scn_checkout_20x_8f31",
  seed: "worldmodel-2026-0713",
  commit: "d4f9a81",
  trafficMultiplier: 20,
  faultTarget: "payment-mock",
  faultType: "http_503",
  faultStartMs: 15000,
  faultDurationMs: 45000,
  journey: "checkout",
  cpuLimit: 2,
  memoryMb: 1024,
});

export const scenarioProfiles = Object.freeze({
  payments: { before: { errors: 32.1, latencyMs: 4060, journeySuccess: 22, recoverySeconds: 74 }, after: { errors: 0.4, latencyMs: 488, journeySuccess: 100, recoverySeconds: 9 } },
  database: { before: { errors: 21.4, latencyMs: 3190, journeySuccess: 54, recoverySeconds: 61 }, after: { errors: 1.2, latencyMs: 734, journeySuccess: 98, recoverySeconds: 12 } },
  traffic: { before: { errors: 18.7, latencyMs: 2840, journeySuccess: 61, recoverySeconds: 48 }, after: { errors: 0.8, latencyMs: 612, journeySuccess: 99, recoverySeconds: 8 } },
});

export function scenarioFingerprint(spec = immutableScenario) {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 12);
}

export function verifyReplay(beforeSpec, afterSpec) {
  const before = scenarioFingerprint(beforeSpec);
  const after = scenarioFingerprint(afterSpec);
  return { identical: before === after, before, after };
}

export function calculateResilience({ errors, latencyMs, journeySuccess, recoverySeconds }) {
  const score = 100 - errors * 1.2 - Math.max(0, latencyMs - 400) / 75 - (100 - journeySuccess) * 0.45 - recoverySeconds * 0.08;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function checkOrderIntegrity(records) {
  const keys = records.map((record) => record.idempotencyKey);
  const duplicates = keys.length - new Set(keys).size;
  return { passed: duplicates === 0, duplicateOrders: duplicates, ordersChecked: records.length };
}

export function scanManifest(manifest) {
  return manifest.components.map((component) => ({
    ...component,
    confidence: component.evidence.length > 1 ? "verified" : "strongly_inferred",
  }));
}
