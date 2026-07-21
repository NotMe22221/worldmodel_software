import {
  validateManifest,
  validateScenario,
  type ScenarioDefinition,
  type WorldModelManifest,
} from "./product-contracts.ts";

export type ObservedMetricSet = {
  resilienceScore: number;
  errorRate: number;
  latencyMs: number;
  journeySuccess: number;
  serviceHealth: number;
};

export type CampaignRunnerEvidence = {
  action: "observe";
  projectId: string;
  scenarioFingerprint: string;
  seed: string;
  environment: {
    id: string;
    revisionId: string;
    destroyedAt: string;
  };
  journey: {
    id: string;
    runner: "playwright";
    name: string;
    startedAt: string;
    endedAt: string;
  };
  before: ObservedMetricSet;
  after: ObservedMetricSet;
};

const metricKeys = ["resilienceScore", "errorRate", "latencyMs", "journeySuccess", "serviceHealth"] as const;
const evidenceKeys = ["action", "projectId", "scenarioFingerprint", "seed", "environment", "journey", "before", "after"] as const;
const environmentKeys = ["id", "revisionId", "destroyedAt"] as const;
const journeyKeys = ["id", "runner", "name", "startedAt", "endedAt"] as const;
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const environmentId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/;
const journeyName = /^[A-Za-z0-9][A-Za-z0-9 _./:-]{2,119}$/;
const fingerprint = /^[a-f0-9]{64}$/;
const maximumClockSkewMs = 5 * 60_000;
const maximumTeardownLagMs = 15 * 60_000;

function strictRecord(value: unknown, label: string, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`evidence_invalid: ${label} is required`);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) throw new Error(`evidence_invalid: ${label} contains missing or unsupported fields`);
  return record;
}

function boundedString(value: unknown, label: string, pattern: RegExp, maximum: number) {
  if (typeof value !== "string" || !value || value.length > maximum || !pattern.test(value)) throw new Error(`evidence_invalid: ${label} is invalid`);
  return value;
}

function boundedTimestamp(value: unknown, label: string) {
  const text = boundedString(value, label, isoTimestamp, 30);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) throw new Error(`evidence_invalid: ${label} is invalid`);
  return { value: new Date(milliseconds).toISOString(), milliseconds };
}

function observedMetrics(value: unknown, label: string): ObservedMetricSet {
  const record = strictRecord(value, `${label} metrics`, metricKeys);
  const result = {} as ObservedMetricSet;
  for (const key of metricKeys) {
    const metric = record[key];
    const minimum = key === "latencyMs" ? 1 : 0;
    const maximum = key === "latencyMs" ? 120_000 : 100;
    if (typeof metric !== "number" || !Number.isFinite(metric) || metric < minimum || metric > maximum) throw new Error(`evidence_invalid: ${label}.${key} must be between ${minimum} and ${maximum}`);
    if (key !== "errorRate" && !Number.isInteger(metric)) throw new Error(`evidence_invalid: ${label}.${key} must be an integer`);
    result[key] = Object.is(metric, -0) ? 0 : metric;
  }
  return result;
}

export async function sha256Hex(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function immutableScenario(value: unknown) {
  const scenario = validateScenario(value);
  if (scenario.evidenceMode !== "observed") throw new Error("scenario_invalid: Campaign runner scenarios must require observed evidence");
  return { scenario, fingerprint: await sha256Hex(JSON.stringify(scenario)) };
}

export function normalizeExecutionManifest(value: unknown): WorldModelManifest {
  const manifest = validateManifest(value);
  const services = manifest.services.map((service) => {
    const name = typeof service.name === "string" ? service.name.trim() : "";
    if (!name || name.length > 100 || service.healthCheck.length > 200 || service.dependsOn.length > 25) throw new Error("manifest_invalid: Service display names, health checks, and dependencies must be bounded");
    return {
      id: service.id,
      name,
      root: service.root,
      start: service.start,
      port: service.port,
      healthCheck: service.healthCheck,
      dependsOn: [...service.dependsOn],
    };
  });
  return {
    version: 1,
    packageManager: manifest.packageManager,
    nodeVersion: manifest.nodeVersion,
    install: manifest.install,
    observeCommand: manifest.observeCommand,
    ...(manifest.seed ? { seed: manifest.seed } : {}),
    services,
    testCommands: [...manifest.testCommands],
    journeyCommands: [...manifest.journeyCommands],
    mocks: manifest.mocks.map((mock) => ({ service: mock.service, mode: mock.mode })),
    secretRefs: [...manifest.secretRefs],
    supportedFaults: [...manifest.supportedFaults],
    resources: {
      cpu: manifest.resources.cpu,
      memoryMb: manifest.resources.memoryMb,
      timeoutSeconds: manifest.resources.timeoutSeconds,
      network: manifest.resources.network,
    },
  };
}

export function normalizeCampaignRunnerEvidence(
  value: unknown,
  immutable: { projectId: string; scenario: ScenarioDefinition; fingerprint: string },
  now = Date.now(),
): CampaignRunnerEvidence & { durationSeconds: number } {
  const payload = strictRecord(value, "Observed evidence", evidenceKeys);
  if (payload.action !== "observe") throw new Error("evidence_invalid: action must be observe");
  if (payload.projectId !== immutable.projectId) throw new Error("evidence_invalid: projectId does not match the signed run");
  if (typeof payload.scenarioFingerprint !== "string" || !fingerprint.test(payload.scenarioFingerprint) || payload.scenarioFingerprint !== immutable.fingerprint) throw new Error("evidence_invalid: scenarioFingerprint does not match the immutable scenario");
  if (typeof payload.seed !== "string" || payload.seed !== immutable.scenario.seed) throw new Error("evidence_invalid: seed does not match the immutable scenario");

  const environment = strictRecord(payload.environment, "environment attestation", environmentKeys);
  const id = boundedString(environment.id, "environment.id", environmentId, 120);
  if (environment.revisionId !== immutable.scenario.environmentRevisionId) throw new Error("evidence_invalid: environment.revisionId does not match the immutable scenario");
  const destroyed = boundedTimestamp(environment.destroyedAt, "environment.destroyedAt");

  const journey = strictRecord(payload.journey, "Playwright journey attestation", journeyKeys);
  if (typeof journey.id !== "string" || !immutable.scenario.journeyIds.includes(journey.id)) throw new Error("evidence_invalid: journey.id is not part of the immutable scenario");
  if (journey.runner !== "playwright") throw new Error("evidence_invalid: journey.runner must be playwright");
  const name = boundedString(journey.name, "journey.name", journeyName, 120);
  const started = boundedTimestamp(journey.startedAt, "journey.startedAt");
  const ended = boundedTimestamp(journey.endedAt, "journey.endedAt");
  const durationMilliseconds = ended.milliseconds - started.milliseconds;
  if (durationMilliseconds < 1_000 || durationMilliseconds > immutable.scenario.durationSeconds * 1_000) throw new Error("evidence_invalid: Playwright timestamps exceed the immutable scenario duration");
  if (destroyed.milliseconds < ended.milliseconds || destroyed.milliseconds - ended.milliseconds > maximumTeardownLagMs) throw new Error("evidence_invalid: Environment teardown must follow Playwright completion within 15 minutes");
  if (destroyed.milliseconds > now + maximumClockSkewMs) throw new Error("evidence_invalid: environment.destroyedAt cannot be more than five minutes in the future");

  return {
    action: "observe",
    projectId: immutable.projectId,
    scenarioFingerprint: immutable.fingerprint,
    seed: immutable.scenario.seed,
    environment: {
      id,
      revisionId: immutable.scenario.environmentRevisionId,
      destroyedAt: destroyed.value,
    },
    journey: {
      id: journey.id,
      runner: "playwright",
      name,
      startedAt: started.value,
      endedAt: ended.value,
    },
    before: observedMetrics(payload.before, "before"),
    after: observedMetrics(payload.after, "after"),
    durationSeconds: Math.ceil(durationMilliseconds / 1_000),
  };
}
