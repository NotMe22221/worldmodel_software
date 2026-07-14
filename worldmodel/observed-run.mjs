const scenarioFingerprints = {
  traffic: "scn_traffic_20x_v1",
  database: "scn_database_800ms_v1",
  payments: "scn_payment_503_45s_v1",
};

function requiredString(value, label, pattern, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${label} is required`);
  const result = value.trim();
  if (pattern && !pattern.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function timestamp(value, label) {
  const result = requiredString(value, label, null, 40);
  const time = Date.parse(result);
  if (!Number.isFinite(time)) throw new Error(`${label} is invalid`);
  return { value: new Date(time).toISOString(), time };
}

function metricSet(value, label) {
  if (!value || typeof value !== "object")
    throw new Error(`${label} metrics are required`);
  const limits = {
    resilienceScore: [0, 100],
    errorRate: [0, 100],
    latencyMs: [1, 120_000],
    journeySuccess: [0, 100],
    serviceHealth: [0, 100],
  };
  const result = {};
  for (const [key, [minimum, maximum]] of Object.entries(limits)) {
    const metric = value[key];
    if (!Number.isFinite(metric) || metric < minimum || metric > maximum)
      throw new Error(`${label}.${key} must be between ${minimum} and ${maximum}`);
    if (key !== "errorRate" && !Number.isInteger(metric))
      throw new Error(`${label}.${key} must be an integer`);
    result[key] = metric;
  }
  return result;
}

export function normalizeObservedRun(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object")
    throw new Error("Observed run payload is required");
  const scenario = payload.scenario;
  if (!Object.hasOwn(scenarioFingerprints, scenario))
    throw new Error("scenario must be traffic, database, or payments");
  const fingerprint = requiredString(
    payload.fingerprint,
    "fingerprint",
    /^[a-z0-9_]{8,100}$/,
    100,
  );
  if (fingerprint !== scenarioFingerprints[scenario])
    throw new Error("fingerprint does not match the supported scenario contract");
  const projectId = requiredString(
    payload.projectId,
    "projectId",
    /^proj_[A-Za-z0-9_-]{3,100}$/,
    110,
  );
  const seed = requiredString(payload.seed, "seed", /^[A-Za-z0-9_-]{8,120}$/, 120);
  const environment = payload.environment;
  if (!environment || typeof environment !== "object")
    throw new Error("environment attestation is required");
  const environmentId = requiredString(
    environment.id,
    "environment.id",
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/,
    120,
  );
  const journey = payload.journey;
  if (!journey || typeof journey !== "object")
    throw new Error("journey attestation is required");
  if (journey.runner !== "playwright")
    throw new Error("journey.runner must be playwright");
  const journeyName = requiredString(
    journey.name,
    "journey.name",
    /^[A-Za-z0-9][A-Za-z0-9 _./:-]{2,119}$/,
    120,
  );
  const started = timestamp(journey.startedAt, "journey.startedAt");
  const ended = timestamp(journey.endedAt, "journey.endedAt");
  const destroyed = timestamp(
    environment.destroyedAt,
    "environment.destroyedAt",
  );
  if (ended.time <= started.time || ended.time - started.time > 2 * 60 * 60_000)
    throw new Error("journey timestamps must describe a run between 1 second and 2 hours");
  if (destroyed.time < ended.time)
    throw new Error("environment.destroyedAt must be at or after journey.endedAt");
  if (destroyed.time > now + 5 * 60_000)
    throw new Error("environment.destroyedAt cannot be in the future");
  return {
    projectId,
    scenario,
    fingerprint,
    seed,
    environmentId,
    environmentDestroyedAt: destroyed.value,
    journeyRunner: "playwright",
    journeyName,
    startedAt: started.value,
    endedAt: ended.value,
    durationSeconds: Math.max(1, Math.round((ended.time - started.time) / 1000)),
    before: metricSet(payload.before, "before"),
    after: metricSet(payload.after, "after"),
  };
}
