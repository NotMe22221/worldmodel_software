export type PackageManager = "npm" | "pnpm" | "yarn";
export type ExecutionBackend = "github_actions";
export type EvidenceMode = "estimated" | "observed";
export type FaultKind = "dependency_outage" | "database_latency" | "traffic_surge";
export type HealthState = "healthy" | "degraded" | "failed" | "unknown";

export type WorldModelService = {
  id: string;
  name: string;
  root: string;
  start: string;
  port: number;
  healthCheck: string;
  dependsOn: string[];
};

export type WorldModelManifest = {
  version: 1;
  packageManager: PackageManager;
  nodeVersion: "20" | "22";
  install: string;
  seed?: string;
  /** Reads WORLDMODEL_EXECUTION_SPEC and writes .worldmodel/observed-run.json. */
  observeCommand: string;
  services: WorldModelService[];
  testCommands: string[];
  journeyCommands: string[];
  mocks: Array<{ service: string; mode: "local" | "proxy" }>;
  secretRefs: string[];
  supportedFaults: FaultKind[];
  resources: { cpu: number; memoryMb: number; timeoutSeconds: number; network: "deny" | "registries" };
};

export type JourneyDefinition = {
  name: string;
  importance: "critical" | "high" | "normal";
  steps: Array<{ name: string; assertion: string }>;
  latencyThresholdMs: number;
  allowedErrorRate: number;
  command: string;
};

export type ScenarioDefinition = {
  name: string;
  modelVersionId: string;
  environmentRevisionId: string;
  seed: string;
  durationSeconds: number;
  workload: { baselineRps: number; peakMultiplier: number; rampSeconds: number };
  faults: Array<{ kind: FaultKind; target: string; startOffsetSeconds: number; durationSeconds: number; latencyMs?: number; responseCode?: number }>;
  journeyIds: string[];
  thresholds: { maxErrorRate: number; maxP95LatencyMs: number; minJourneySuccess: number };
  cleanupPolicy: "always";
  evidenceMode: EvidenceMode;
};

export type CampaignPlan = {
  name: string;
  objective: string;
  scenarios: ScenarioDefinition[];
  concurrency: number;
  estimatedMinutes: number;
  assumptions: string[];
};

export type RunEventType =
  | "run.created" | "environment.provisioning" | "environment.ready"
  | "baseline.started" | "baseline.completed" | "load.changed"
  | "fault.injected" | "fault.recovered" | "service.degraded"
  | "service.failed" | "service.recovered" | "journey.step_started"
  | "journey.step_failed" | "threshold.breached" | "trace.highlighted"
  | "artifact.created" | "run.completed" | "run.cancelled" | "run.failed"
  | "investigation.started" | "hypothesis.created" | "candidate.created"
  | "verification.completed" | "report.published";

export type RunEvent = { sequence: number; type: RunEventType; timestamp: string; source: string; serviceId?: string; journeyId?: string; payload: Record<string, unknown>; evidenceRef?: string };

const idPattern = /^[a-z][a-z0-9_-]{1,79}$/;
const safeCommand = /^(npm|pnpm|yarn|npx)\s+[A-Za-z0-9_@./:= -]{1,240}$/;
const secretRefPattern = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const faultKinds = new Set<FaultKind>(["dependency_outage", "database_latency", "traffic_surge"]);
const networkModes = new Set<WorldModelManifest["resources"]["network"]>(["deny", "registries"]);

function normalizedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateManifest(value: unknown): WorldModelManifest {
  if (!value || typeof value !== "object") throw new Error("manifest_invalid: A WorldModel manifest is required");
  const input = value as Partial<WorldModelManifest>;
  if (input.version !== 1) throw new Error("manifest_invalid: Manifest version must be 1");
  if (!input.packageManager || !["npm", "pnpm", "yarn"].includes(input.packageManager)) throw new Error("manifest_invalid: Unsupported package manager");
  if (!input.nodeVersion || !["20", "22"].includes(input.nodeVersion)) throw new Error("manifest_invalid: Node version must be 20 or 22");
  const install = normalizedString(input.install);
  if (!install || !safeCommand.test(install)) throw new Error("manifest_invalid: Install command is not allowed");
  const observeCommand = normalizedString(input.observeCommand);
  if (!observeCommand || !safeCommand.test(observeCommand)) throw new Error("manifest_invalid: A safe observeCommand is required for observed runner evidence");
  if (!Array.isArray(input.services) || input.services.length === 0 || input.services.length > 25) throw new Error("manifest_invalid: Between 1 and 25 services are required");
  const ids = new Set<string>();
  for (const service of input.services) {
    if (!service || typeof service !== "object" || !idPattern.test(service.id) || ids.has(service.id)) throw new Error("manifest_invalid: Service IDs must be unique safe identifiers");
    ids.add(service.id);
    if (!safeCommand.test(service.start) || !/^[A-Za-z0-9_./-]{1,160}$/.test(service.root) || service.root.split("/").includes("..") || !/^\/[A-Za-z0-9_./?=&-]*$/.test(service.healthCheck) || !Number.isInteger(service.port) || service.port < 1024 || service.port > 65535) throw new Error(`manifest_invalid: Service ${service.id} has unsafe startup settings`);
  }
  for (const service of input.services) {
    if (!Array.isArray(service.dependsOn) || new Set(service.dependsOn).size !== service.dependsOn.length || service.dependsOn.some((dependency) => !ids.has(dependency) || dependency === service.id)) throw new Error(`manifest_invalid: Service ${service.id} has invalid dependencies`);
  }
  if (!Array.isArray(input.testCommands) || input.testCommands.length > 50 || !Array.isArray(input.journeyCommands) || input.journeyCommands.length > 50) throw new Error("manifest_invalid: Test and journey commands must be bounded lists");
  const testCommands = input.testCommands.map(normalizedString);
  const journeyCommands = input.journeyCommands.map(normalizedString);
  const seed = input.seed == null ? undefined : normalizedString(input.seed);
  for (const command of [...testCommands, ...journeyCommands, ...(seed ? [seed] : [])]) if (!safeCommand.test(command)) throw new Error("manifest_invalid: Test, seed, and journey commands must use the command allowlist");
  const resources = input.resources;
  if (!resources || !Number.isFinite(resources.cpu) || resources.cpu < 0.25 || resources.cpu > 4 || !Number.isInteger(resources.memoryMb) || resources.memoryMb < 256 || resources.memoryMb > 8192 || !Number.isInteger(resources.timeoutSeconds) || resources.timeoutSeconds < 30 || resources.timeoutSeconds > 3600) throw new Error("manifest_invalid: Resource limits are outside the supported range");
  const network = normalizedString(resources.network) as WorldModelManifest["resources"]["network"];
  if (!networkModes.has(network)) throw new Error("manifest_invalid: Resource network access must be deny or registries");

  if (!Array.isArray(input.mocks) || input.mocks.length > 25) throw new Error("manifest_invalid: Mocks must contain at most 25 safe service definitions");
  const mockIds = new Set<string>();
  const mocks = input.mocks.map((mock) => {
    const service = normalizedString(mock?.service);
    const mode = normalizedString(mock?.mode) as WorldModelManifest["mocks"][number]["mode"];
    if (!idPattern.test(service) || mockIds.has(service) || !["local", "proxy"].includes(mode)) throw new Error("manifest_invalid: Mock service IDs must be unique and use a supported mode");
    mockIds.add(service);
    return { service, mode };
  });

  if (!Array.isArray(input.secretRefs) || input.secretRefs.length > 50) throw new Error("manifest_invalid: Secret references must be a bounded list of environment variable names");
  const secretRefs = [...new Set(input.secretRefs.map((reference) => normalizedString(reference)))];
  if (secretRefs.some((reference) => !secretRefPattern.test(reference))) throw new Error("manifest_invalid: Secret references must be safe environment variable names");

  if (!Array.isArray(input.supportedFaults) || input.supportedFaults.length > faultKinds.size) throw new Error("manifest_invalid: Supported faults must use the fault allowlist");
  const supportedFaults = [...new Set(input.supportedFaults.map((kind) => normalizedString(kind) as FaultKind))];
  if (supportedFaults.some((kind) => !faultKinds.has(kind))) throw new Error("manifest_invalid: Supported faults must use the fault allowlist");

  return {
    ...input,
    install,
    observeCommand,
    ...(seed ? { seed } : { seed: undefined }),
    testCommands,
    journeyCommands,
    mocks,
    secretRefs,
    supportedFaults,
    resources: { ...resources, network },
  } as WorldModelManifest;
}

export function validateJourney(value: unknown): JourneyDefinition {
  if (!value || typeof value !== "object") throw new Error("journey_invalid: Journey definition is required");
  const input = value as Partial<JourneyDefinition>;
  const name = normalizedString(input.name);
  if (!name || name.length > 100 || !Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 30) throw new Error("journey_invalid: Journey name and 1-30 steps are required");
  const importance = normalizedString(input.importance) as JourneyDefinition["importance"];
  if (!["critical", "high", "normal"].includes(importance)) throw new Error("journey_invalid: Importance must be critical, high, or normal");
  const steps = input.steps.map((step) => {
    const stepName = normalizedString(step?.name);
    const assertion = normalizedString(step?.assertion);
    if (!stepName || stepName.length > 200 || !assertion || assertion.length > 1000) throw new Error("journey_invalid: Every journey step requires a bounded name and assertion");
    return { name: stepName, assertion };
  });
  const command = normalizedString(input.command);
  if (!command || !safeCommand.test(command)) throw new Error("journey_invalid: Journey command is not allowed");
  if (typeof input.latencyThresholdMs !== "number" || !Number.isFinite(input.latencyThresholdMs) || input.latencyThresholdMs < 50 || input.latencyThresholdMs > 120000) throw new Error("journey_invalid: Latency threshold is outside the supported range");
  if (typeof input.allowedErrorRate !== "number" || !Number.isFinite(input.allowedErrorRate) || input.allowedErrorRate < 0 || input.allowedErrorRate > 100) throw new Error("journey_invalid: Allowed error rate must be 0-100");
  return { name, importance, steps, latencyThresholdMs: input.latencyThresholdMs, allowedErrorRate: input.allowedErrorRate, command };
}

export function validateScenario(value: unknown): ScenarioDefinition {
  if (!value || typeof value !== "object") throw new Error("scenario_invalid: Scenario definition is required");
  const input = value as Partial<ScenarioDefinition>;
  const name = normalizedString(input.name);
  const modelVersionId = normalizedString(input.modelVersionId);
  const environmentRevisionId = normalizedString(input.environmentRevisionId);
  const seed = normalizedString(input.seed);
  if (!name || name.length > 100 || !idPattern.test(modelVersionId) || !idPattern.test(environmentRevisionId) || !/^[A-Za-z0-9_.:-]{1,200}$/.test(seed)) throw new Error("scenario_invalid: Name, safe model and environment IDs, and a bounded seed are required");
  if (typeof input.durationSeconds !== "number" || !Number.isInteger(input.durationSeconds) || input.durationSeconds < 10 || input.durationSeconds > 900) throw new Error("scenario_invalid: Duration must be 10-900 seconds");
  const durationSeconds = input.durationSeconds;

  const workload = input.workload;
  if (!workload || typeof workload.baselineRps !== "number" || !Number.isFinite(workload.baselineRps) || workload.baselineRps < 0 || workload.baselineRps > 10_000 || typeof workload.peakMultiplier !== "number" || !Number.isFinite(workload.peakMultiplier) || workload.peakMultiplier < 1 || workload.peakMultiplier > 100 || typeof workload.rampSeconds !== "number" || !Number.isInteger(workload.rampSeconds) || workload.rampSeconds < 0 || workload.rampSeconds > durationSeconds) throw new Error("scenario_invalid: Workload is outside the supported range");

  if (!Array.isArray(input.faults) || input.faults.length > 8 || !Array.isArray(input.journeyIds) || input.journeyIds.length === 0 || input.journeyIds.length > 50) throw new Error("scenario_invalid: Between one and fifty journeys and no more than eight faults are allowed");
  const faults = input.faults.map((fault) => {
    const kind = normalizedString(fault?.kind) as FaultKind;
    const target = normalizedString(fault?.target);
    if (!fault || !faultKinds.has(kind) || !idPattern.test(target) || typeof fault.startOffsetSeconds !== "number" || !Number.isInteger(fault.startOffsetSeconds) || fault.startOffsetSeconds < 0 || typeof fault.durationSeconds !== "number" || !Number.isInteger(fault.durationSeconds) || fault.durationSeconds < 1 || fault.startOffsetSeconds + fault.durationSeconds > durationSeconds) throw new Error("scenario_invalid: Fault timing or target is invalid");
    if (fault.latencyMs != null && (typeof fault.latencyMs !== "number" || !Number.isInteger(fault.latencyMs) || fault.latencyMs < 0 || fault.latencyMs > 120000)) throw new Error("scenario_invalid: Fault latency is outside the supported range");
    if (fault.responseCode != null && (typeof fault.responseCode !== "number" || !Number.isInteger(fault.responseCode) || fault.responseCode < 100 || fault.responseCode > 599)) throw new Error("scenario_invalid: Fault response code is invalid");
    return {
      kind,
      target,
      startOffsetSeconds: fault.startOffsetSeconds,
      durationSeconds: fault.durationSeconds,
      ...(fault.latencyMs == null ? {} : { latencyMs: fault.latencyMs }),
      ...(fault.responseCode == null ? {} : { responseCode: fault.responseCode }),
    };
  });

  const journeyIds = input.journeyIds.map((journeyId) => normalizedString(journeyId));
  if (journeyIds.some((journeyId) => !idPattern.test(journeyId)) || new Set(journeyIds).size !== journeyIds.length) throw new Error("scenario_invalid: Journey IDs must be unique safe identifiers");

  const thresholds = input.thresholds;
  if (!thresholds || typeof thresholds.maxErrorRate !== "number" || !Number.isFinite(thresholds.maxErrorRate) || thresholds.maxErrorRate < 0 || thresholds.maxErrorRate > 100 || typeof thresholds.maxP95LatencyMs !== "number" || !Number.isInteger(thresholds.maxP95LatencyMs) || thresholds.maxP95LatencyMs < 1 || thresholds.maxP95LatencyMs > 120000 || typeof thresholds.minJourneySuccess !== "number" || !Number.isFinite(thresholds.minJourneySuccess) || thresholds.minJourneySuccess < 0 || thresholds.minJourneySuccess > 100) throw new Error("scenario_invalid: Thresholds are outside the supported range");
  if (input.cleanupPolicy !== "always") throw new Error("scenario_invalid: Cleanup policy must always run");
  if (input.evidenceMode !== "estimated" && input.evidenceMode !== "observed") throw new Error("scenario_invalid: Evidence mode must be estimated or observed");

  return {
    name,
    modelVersionId,
    environmentRevisionId,
    seed,
    durationSeconds,
    workload: { baselineRps: workload.baselineRps, peakMultiplier: workload.peakMultiplier, rampSeconds: workload.rampSeconds },
    faults,
    journeyIds,
    thresholds: { maxErrorRate: thresholds.maxErrorRate, maxP95LatencyMs: thresholds.maxP95LatencyMs, minJourneySuccess: thresholds.minJourneySuccess },
    cleanupPolicy: "always",
    evidenceMode: input.evidenceMode,
  };
}

export function validateCampaign(value: unknown): CampaignPlan {
  if (!value || typeof value !== "object") throw new Error("campaign_invalid: Campaign plan is required");
  const input = value as Partial<CampaignPlan>;
  const name = normalizedString(input.name);
  const objective = normalizedString(input.objective);
  if (!name || name.length > 120 || !objective || objective.length > 2_000 || !Array.isArray(input.scenarios) || input.scenarios.length < 1 || input.scenarios.length > 20) throw new Error("campaign_invalid: Campaigns require a bounded name, objective, and 1-20 scenarios");
  if (!Number.isInteger(input.concurrency) || Number(input.concurrency) < 1 || Number(input.concurrency) > 3) throw new Error("campaign_invalid: Campaign concurrency must be 1-3");
  const scenarios = input.scenarios.map(validateScenario);
  if (new Set(scenarios.map((scenario) => JSON.stringify(scenario))).size !== scenarios.length) throw new Error("campaign_invalid: Campaign scenarios must be unique");
  const estimatedMinutes = Math.ceil(scenarios.reduce((sum, scenario) => sum + scenario.durationSeconds, 0) / 60);
  if (input.assumptions != null && !Array.isArray(input.assumptions)) throw new Error("campaign_invalid: Assumptions must be a bounded list");
  const assumptions = (input.assumptions || []).slice(0, 20).map(normalizedString);
  if (assumptions.some((assumption) => !assumption || assumption.length > 500)) throw new Error("campaign_invalid: Assumptions must be non-empty and at most 500 characters");
  return { ...input, name, objective, scenarios, estimatedMinutes, assumptions } as CampaignPlan;
}

export function candidateScore(input: { resilienceImprovement: number; regressionSafety: number; complexity: number; performance: number; security: number; evidenceConfidence: number; hardGatesPassed: boolean }) {
  if (!input.hardGatesPassed) return 0;
  const bounded = (value: number) => Math.max(0, Math.min(100, value));
  return Math.round(bounded(input.resilienceImprovement) * .35 + bounded(input.regressionSafety) * .25 + (100 - bounded(input.complexity)) * .15 + bounded(input.performance) * .10 + bounded(input.security) * .10 + bounded(input.evidenceConfidence) * .05);
}
