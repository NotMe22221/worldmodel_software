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

export function validateManifest(value: unknown): WorldModelManifest {
  if (!value || typeof value !== "object") throw new Error("manifest_invalid: A WorldModel manifest is required");
  const input = value as Partial<WorldModelManifest>;
  if (input.version !== 1) throw new Error("manifest_invalid: Manifest version must be 1");
  if (!input.packageManager || !["npm", "pnpm", "yarn"].includes(input.packageManager)) throw new Error("manifest_invalid: Unsupported package manager");
  if (!input.nodeVersion || !["20", "22"].includes(input.nodeVersion)) throw new Error("manifest_invalid: Node version must be 20 or 22");
  if (!input.install || !safeCommand.test(input.install)) throw new Error("manifest_invalid: Install command is not allowed");
  if (!Array.isArray(input.services) || input.services.length === 0 || input.services.length > 25) throw new Error("manifest_invalid: Between 1 and 25 services are required");
  const ids = new Set<string>();
  for (const service of input.services) {
    if (!idPattern.test(service.id) || ids.has(service.id)) throw new Error("manifest_invalid: Service IDs must be unique safe identifiers");
    ids.add(service.id);
    if (!safeCommand.test(service.start) || !/^[A-Za-z0-9_./-]{1,160}$/.test(service.root) || service.root.split("/").includes("..") || !/^\/[A-Za-z0-9_./?=&-]*$/.test(service.healthCheck) || service.port < 1024 || service.port > 65535) throw new Error(`manifest_invalid: Service ${service.id} has unsafe startup settings`);
  }
  for (const service of input.services) if (!Array.isArray(service.dependsOn) || service.dependsOn.some((dependency) => !ids.has(dependency) || dependency === service.id)) throw new Error(`manifest_invalid: Service ${service.id} has invalid dependencies`);
  for (const command of [...(input.testCommands || []), ...(input.journeyCommands || []), ...(input.seed ? [input.seed] : [])]) if (!safeCommand.test(command)) throw new Error("manifest_invalid: Test, seed, and journey commands must use the command allowlist");
  if (!input.resources || input.resources.cpu < 0.25 || input.resources.cpu > 4 || input.resources.memoryMb < 256 || input.resources.memoryMb > 8192 || input.resources.timeoutSeconds < 30 || input.resources.timeoutSeconds > 3600) throw new Error("manifest_invalid: Resource limits are outside the supported range");
  return input as WorldModelManifest;
}

export function validateJourney(value: unknown): JourneyDefinition {
  if (!value || typeof value !== "object") throw new Error("journey_invalid: Journey definition is required");
  const input = value as Partial<JourneyDefinition>;
  if (!input.name?.trim() || input.name.length > 100 || !Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 30) throw new Error("journey_invalid: Journey name and 1-30 steps are required");
  if (!input.command || !safeCommand.test(input.command)) throw new Error("journey_invalid: Journey command is not allowed");
  if (!Number.isFinite(input.latencyThresholdMs) || Number(input.latencyThresholdMs) < 50 || Number(input.latencyThresholdMs) > 120000) throw new Error("journey_invalid: Latency threshold is outside the supported range");
  if (!Number.isFinite(input.allowedErrorRate) || Number(input.allowedErrorRate) < 0 || Number(input.allowedErrorRate) > 100) throw new Error("journey_invalid: Allowed error rate must be 0-100");
  return input as JourneyDefinition;
}

export function validateScenario(value: unknown): ScenarioDefinition {
  if (!value || typeof value !== "object") throw new Error("scenario_invalid: Scenario definition is required");
  const input = value as Partial<ScenarioDefinition>;
  if (!input.name?.trim() || !input.modelVersionId || !input.environmentRevisionId || !input.seed) throw new Error("scenario_invalid: Name, model, environment, and seed are required");
  if (!Number.isInteger(input.durationSeconds) || Number(input.durationSeconds) < 10 || Number(input.durationSeconds) > 900) throw new Error("scenario_invalid: Duration must be 10-900 seconds");
  if (!Array.isArray(input.faults) || input.faults.length > 8 || !Array.isArray(input.journeyIds) || input.journeyIds.length === 0) throw new Error("scenario_invalid: At least one journey and no more than eight faults are allowed");
  for (const fault of input.faults) {
    if (!fault || !["dependency_outage", "database_latency", "traffic_surge"].includes(fault.kind) || !idPattern.test(fault.target) || fault.startOffsetSeconds < 0 || fault.durationSeconds < 1 || fault.startOffsetSeconds + fault.durationSeconds > Number(input.durationSeconds)) throw new Error("scenario_invalid: Fault timing or target is invalid");
  }
  return { ...input, cleanupPolicy: "always" } as ScenarioDefinition;
}

export function validateCampaign(value: unknown): CampaignPlan {
  if (!value || typeof value !== "object") throw new Error("campaign_invalid: Campaign plan is required");
  const input = value as Partial<CampaignPlan>;
  if (!input.name?.trim() || !input.objective?.trim() || !Array.isArray(input.scenarios) || input.scenarios.length < 1 || input.scenarios.length > 20) throw new Error("campaign_invalid: Campaigns require 1-20 scenarios");
  if (!Number.isInteger(input.concurrency) || Number(input.concurrency) < 1 || Number(input.concurrency) > 3) throw new Error("campaign_invalid: Campaign concurrency must be 1-3");
  input.scenarios.forEach(validateScenario);
  const estimatedMinutes = Math.ceil(input.scenarios.reduce((sum, scenario) => sum + scenario.durationSeconds, 0) / 60);
  return { ...input, estimatedMinutes, assumptions: Array.isArray(input.assumptions) ? input.assumptions.slice(0, 20) : [] } as CampaignPlan;
}

export function candidateScore(input: { resilienceImprovement: number; regressionSafety: number; complexity: number; performance: number; security: number; evidenceConfidence: number; hardGatesPassed: boolean }) {
  if (!input.hardGatesPassed) return 0;
  const bounded = (value: number) => Math.max(0, Math.min(100, value));
  return Math.round(bounded(input.resilienceImprovement) * .35 + bounded(input.regressionSafety) * .25 + (100 - bounded(input.complexity)) * .15 + bounded(input.performance) * .10 + bounded(input.security) * .10 + bounded(input.evidenceConfidence) * .05);
}
