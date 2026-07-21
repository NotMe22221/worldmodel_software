import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DRAFT_PR_PUBLICATION_LEASE_MS, deterministicDraftPrBranch, draftPrPublicationLeaseExpired } from "../db/draft-pr-publication.ts";
import { draftCampaignSchema } from "../server/openai-campaign-schema.ts";
import { candidateScore, validateCampaign, validateJourney, validateManifest, validateScenario } from "../worldmodel/product-contracts.ts";
import { normalizeExecutionManifest } from "../worldmodel/runner-evidence.ts";
import { evaluateCampaignExecutionReadiness } from "../worldmodel/execution-readiness.mjs";
import { candidateArtifactSha256, verifyCandidateArtifact } from "../worldmodel/candidate-artifact.ts";

const manifest = { version: 1, packageManager: "npm", nodeVersion: "22", install: "npm ci", observeCommand: "npm run worldmodel:observe", services: [{ id: "web", name: "Web", root: ".", start: "npm run dev", port: 3000, healthCheck: "/health", dependsOn: [] }], testCommands: ["npm test"], journeyCommands: ["npx playwright test"], mocks: [], secretRefs: [], supportedFaults: ["traffic_surge"], resources: { cpu: 1, memoryMb: 1024, timeoutSeconds: 300, network: "registries" } };
const journey = { name: "Checkout", importance: "critical", steps: [{ name: "Submit order", assertion: "A confirmation is shown" }], latencyThresholdMs: 2000, allowedErrorRate: 1, command: "npx playwright test" };
const scenario = { name: "load", modelVersionId: "model_1", environmentRevisionId: "env_1", seed: "seed", durationSeconds: 60, workload: { baselineRps: 1, peakMultiplier: 20, rampSeconds: 5 }, faults: [{ kind: "traffic_surge", target: "web", startOffsetSeconds: 5, durationSeconds: 30 }], journeyIds: ["journey_1"], thresholds: { maxErrorRate: 2, maxP95LatencyMs: 800, minJourneySuccess: 99 }, cleanupPolicy: "always", evidenceMode: "observed" };

test("validates a bounded executable manifest", () => assert.equal(validateManifest(manifest).services[0].id, "web"));
test("rejects shell metacharacters in repository commands", () => assert.throws(() => validateManifest({ ...manifest, install: "npm ci && curl bad" }), /not allowed/));
test("requires and normalizes a safe observed-evidence command", () => {
  assert.equal(validateManifest({ ...manifest, observeCommand: " npm run worldmodel:observe " }).observeCommand, "npm run worldmodel:observe");
  assert.equal(normalizeExecutionManifest({ ...manifest, observeCommand: " npm run worldmodel:observe " }).observeCommand, "npm run worldmodel:observe");
  const legacyManifest = { ...manifest };
  delete legacyManifest.observeCommand;
  assert.throws(() => validateManifest(legacyManifest), /observeCommand/);
  assert.throws(() => validateManifest({ ...manifest, observeCommand: "npm run worldmodel:observe && curl bad" }), /observeCommand/);
});
test("repository environment fixtures include the observed-evidence command", async () => {
  const fixture = JSON.parse(await readFile(new URL("../sample-app/worldmodel.manifest.json", import.meta.url), "utf8"));
  const projectPage = await readFile(new URL("../app/projects/[projectId]/page.tsx", import.meta.url), "utf8");
  assert.equal(fixture.observeCommand, "npm run worldmodel:observe");
  assert.match(projectPage, /observeCommand: "npm run worldmodel:observe"/);
});
test("live replay keeps campaign-run event identity while showing linked observed metrics", async () => {
  const product = await readFile(new URL("../db/product.ts", import.meta.url), "utf8");
  const campaignRuns = await readFile(new URL("../worldmodel/campaign-runs.mjs", import.meta.url), "utf8");
  const projectPage = await readFile(new URL("../app/projects/[projectId]/page.tsx", import.meta.url), "utf8");
  const liveRunsView = projectPage.match(/function LiveRunsView[\s\S]*?(?=function LiveReplay)/)?.[0] || "";

  assert.match(product, /db\.prepare\(campaignReplayRowsSql\)/);
  assert.match(campaignRuns, /LEFT JOIN simulation_runs sr ON sr\.id = cr\.simulation_run_id/);
  assert.match(campaignRuns, /SELECT cr\.\*, sr\.scenario, sr\.error_rate, sr\.latency_ms, sr\.journey_success/);
  assert.match(liveRunsView, /campaignRuns\.map\(\(run\)/);
  assert.match(liveRunsView, /selectedRunId = campaignRuns\.some/);
  assert.match(liveRunsView, /<LiveReplay key=\{selectedRunId\} projectId=\{projectId\} runId=\{selectedRunId\}/);
  assert.doesNotMatch(liveRunsView, /runs\.some|\.\.\.runs/);
});
test("campaign approval exposes every immutable scenario and replay controls select historical evidence", async () => {
  const projectPage = await readFile(new URL("../app/projects/[projectId]/page.tsx", import.meta.url), "utf8");
  const campaignDisclosure = projectPage.match(/function CampaignPlanDetails[\s\S]*?(?=function CampaignsView)/)?.[0] || "";
  const campaignControl = projectPage.match(/function CampaignControlView[\s\S]*?(?=function LiveRunsView)/)?.[0] || "";
  const replay = projectPage.match(/function LiveReplay[\s\S]*?(?=function RepairTournamentView)/)?.[0] || "";

  assert.match(campaignDisclosure, /scenarios\.map\(\(scenario, index\)/);
  assert.match(campaignDisclosure, /Workload/);
  assert.match(campaignDisclosure, /Faults/);
  assert.match(campaignDisclosure, /Hard gates/);
  assert.match(campaignDisclosure, /scenario\.modelVersionId/);
  assert.match(campaignDisclosure, /scenario\.environmentRevisionId/);
  assert.match(campaignDisclosure, /journeys\.join/);
  assert.match(campaignDisclosure, /ASSUMPTIONS/);
  assert.match(campaignControl, /<CampaignPlanDetails plan=\{plan\}/);
  assert.doesNotMatch(campaignControl, /scenarios\?\.slice|scenario-chips/);
  assert.match(replay, /onChange=\{\(event\) => selectEvent/);
  assert.match(replay, /visibleEvents = events\.slice\(0, selectedPosition \+ 1\)/);
  assert.match(replay, /aria-current=\{index === selectedPosition \? "step"/);
  assert.doesNotMatch(replay, /readOnly/);
});
test("GitHub connection stays one-click for workspace users while provider setup stays operator-only", async () => {
  const dashboard = await readFile(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
  const saasRoute = await readFile(new URL("../app/api/saas/route.ts", import.meta.url), "utf8");
  const providerRoute = await readFile(new URL("../app/api/provider-settings/route.ts", import.meta.url), "utf8");
  const providerLayout = await readFile(new URL("../app/settings/layout.tsx", import.meta.url), "utf8");
  const composioStart = await readFile(new URL("../app/api/integrations/composio/github/start/route.ts", import.meta.url), "utf8");
  const readiness = await readFile(new URL("../server/readiness.ts", import.meta.url), "utf8");

  assert.match(dashboard, /You will not need a Composio account or API key/);
  assert.match(dashboard, /data\.operatorAccess \? \([\s\S]*View platform setup instructions/);
  assert.match(dashboard, /<button className="secondary-integration" disabled>Connect GitHub/);
  assert.match(saasRoute, /operatorAccess[\s\S]*missing: \[\]/);
  assert.match(providerRoute, /Platform operator access required/);
  assert.match(providerLayout, /mode\.editable && !localOwner/);
  assert.match(providerLayout, /!mode\.editable && !operatorAccess/);
  assert.match(composioStart, /COMPOSIO_NOT_CONFIGURED" \? "unavailable" : "start_error"/);
  assert.match(readiness, /workspace users do not provide provider credentials/);
  assert.doesNotMatch(readiness, /Composio GitHub OAuth credentials are missing/);
});
test("rejects service path traversal and unknown dependency targets", () => {
  assert.throws(() => validateManifest({ ...manifest, services: [{ ...manifest.services[0], root: "../outside" }] }), /unsafe startup/);
  assert.throws(() => validateManifest({ ...manifest, services: [{ ...manifest.services[0], dependsOn: ["missing"] }] }), /invalid dependencies/);
});
test("normalizes bounded manifest network, mocks, secrets, and supported faults", () => {
  const result = validateManifest({
    ...manifest,
    mocks: [{ service: " stripe-api ", mode: " proxy " }],
    secretRefs: [" STRIPE_API_KEY ", "STRIPE_API_KEY"],
    supportedFaults: [" traffic_surge ", "traffic_surge"],
    resources: { ...manifest.resources, network: " registries " },
  });
  assert.equal(result.resources.network, "registries");
  assert.deepEqual(result.mocks, [{ service: "stripe-api", mode: "proxy" }]);
  assert.deepEqual(result.secretRefs, ["STRIPE_API_KEY"]);
  assert.deepEqual(result.supportedFaults, ["traffic_surge"]);
});
test("rejects unbounded or unsafe manifest execution fields", () => {
  assert.throws(() => validateManifest({ ...manifest, resources: { ...manifest.resources, network: "internet" } }), /network access/);
  assert.throws(() => validateManifest({ ...manifest, mocks: [{ service: "bad/service", mode: "local" }] }), /Mock service IDs/);
  assert.throws(() => validateManifest({ ...manifest, mocks: [{ service: "stripe-api", mode: "local" }, { service: "stripe-api", mode: "proxy" }] }), /Mock service IDs/);
  assert.throws(() => validateManifest({ ...manifest, secretRefs: ["TOKEN=plaintext"] }), /Secret references/);
  assert.throws(() => validateManifest({ ...manifest, supportedFaults: ["filesystem_delete"] }), /fault allowlist/);
  assert.throws(() => validateManifest({ ...manifest, testCommands: "npm test" }), /bounded lists/);
  assert.throws(() => validateManifest({ ...manifest, journeyCommands: Array(51).fill("npm test") }), /bounded lists/);
});
test("journeys require canonical importance and bounded steps", () => {
  assert.equal(validateJourney({ ...journey, name: " Checkout " }).name, "Checkout");
  assert.throws(() => validateJourney({ ...journey, importance: "standard" }), /Importance/);
  assert.throws(() => validateJourney({ ...journey, steps: [{ name: "Submit", assertion: "" }] }), /journey step/);
});
test("scenarios bound workload, thresholds, identifiers, and execution modes", () => {
  assert.throws(() => validateScenario({ ...scenario, workload: { ...scenario.workload, baselineRps: 10_001 } }), /Workload/);
  assert.throws(() => validateScenario({ ...scenario, workload: { ...scenario.workload, peakMultiplier: 101 } }), /Workload/);
  assert.throws(() => validateScenario({ ...scenario, workload: { ...scenario.workload, rampSeconds: 61 } }), /Workload/);
  assert.throws(() => validateScenario({ ...scenario, thresholds: { ...scenario.thresholds, maxErrorRate: 101 } }), /Thresholds/);
  assert.throws(() => validateScenario({ ...scenario, thresholds: { ...scenario.thresholds, maxP95LatencyMs: 120_001 } }), /Thresholds/);
  assert.throws(() => validateScenario({ ...scenario, journeyIds: ["journey_1", "journey_1"] }), /Journey IDs/);
  assert.throws(() => validateScenario({ ...scenario, modelVersionId: "../model" }), /safe model/);
  assert.throws(() => validateScenario({ ...scenario, faults: [{ ...scenario.faults[0], target: "../web" }] }), /Fault timing or target/);
  assert.throws(() => validateScenario({ ...scenario, cleanupPolicy: "on_success" }), /Cleanup policy/);
  assert.throws(() => validateScenario({ ...scenario, evidenceMode: "self_attested" }), /Evidence mode/);
});
test("campaigns are limited to twenty scenarios and three workers", () => {
  assert.equal(validateCampaign({ name: "matrix", objective: "find risk", scenarios: [scenario], concurrency: 3, assumptions: [] }).estimatedMinutes, 1);
  assert.throws(() => validateCampaign({ name: "too large", objective: "x", scenarios: Array(21).fill(scenario), concurrency: 3 }), /1-20/);
  assert.throws(() => validateCampaign({ name: "duplicate", objective: "x", scenarios: [scenario, { ...scenario }], concurrency: 1 }), /must be unique/);
});
test("campaigns retain normalized scenarios", () => {
  const result = validateCampaign({
    name: "matrix",
    objective: "find risk",
    scenarios: [{ ...scenario, name: " load ", journeyIds: [" journey_1 "], faults: [{ ...scenario.faults[0], target: " web ", latencyMs: null, responseCode: null }] }],
    concurrency: 1,
    assumptions: [],
  });
  assert.equal(result.scenarios[0].name, "load");
  assert.deepEqual(result.scenarios[0].journeyIds, ["journey_1"]);
  assert.deepEqual(result.scenarios[0].faults[0], scenario.faults[0]);
});
test("campaign metadata and seeds are bounded", () => {
  assert.throws(() => validateCampaign({ name: "x".repeat(121), objective: "risk", scenarios: [scenario], concurrency: 1 }), /bounded name/);
  assert.throws(() => validateCampaign({ name: "matrix", objective: "risk", scenarios: [{ ...scenario, seed: "unsafe seed" }], concurrency: 1 }), /bounded seed/);
  assert.throws(() => validateCampaign({ name: "matrix", objective: "risk", scenarios: [scenario], concurrency: 1, assumptions: ["x".repeat(501)] }), /500 characters/);
});
test("OpenAI campaign drafts use the same direct bounds, enums, and identifier patterns as runtime validation", () => {
  const plan = draftCampaignSchema.properties.plan;
  const scenario = plan.properties.scenarios.items.properties;
  const workload = scenario.workload.properties;
  const fault = scenario.faults.items.properties;
  const thresholds = scenario.thresholds.properties;

  assert.deepEqual(plan.properties.name, { type: "string", minLength: 1, maxLength: 120, pattern: "\\S" });
  assert.deepEqual(plan.properties.objective, { type: "string", minLength: 1, maxLength: 2_000, pattern: "\\S" });
  assert.deepEqual(plan.properties.concurrency, { type: "integer", minimum: 1, maximum: 3 });
  assert.deepEqual(plan.properties.estimatedMinutes, { type: "integer", minimum: 1, maximum: 300 });
  assert.equal(plan.properties.assumptions.maxItems, 20);
  assert.deepEqual(plan.properties.assumptions.items, { type: "string", minLength: 1, maxLength: 500, pattern: "\\S" });
  assert.equal(plan.properties.scenarios.minItems, 1);
  assert.equal(plan.properties.scenarios.maxItems, 20);
  assert.deepEqual(scenario.name, { type: "string", minLength: 1, maxLength: 100, pattern: "\\S" });
  assert.deepEqual(scenario.modelVersionId, { type: "string", pattern: "^[a-z][a-z0-9_-]{1,79}$" });
  assert.deepEqual(scenario.environmentRevisionId, scenario.modelVersionId);
  assert.deepEqual(scenario.seed, { type: "string", pattern: "^[A-Za-z0-9_.:-]{1,200}$" });
  assert.deepEqual(scenario.durationSeconds, { type: "integer", minimum: 10, maximum: 900 });
  assert.deepEqual(workload.baselineRps, { type: "number", minimum: 0, maximum: 10_000 });
  assert.deepEqual(workload.peakMultiplier, { type: "number", minimum: 1, maximum: 100 });
  assert.deepEqual(workload.rampSeconds, { type: "integer", minimum: 0, maximum: 900 });
  assert.equal(scenario.faults.maxItems, 8);
  assert.deepEqual(fault.kind.enum, ["dependency_outage", "database_latency", "traffic_surge"]);
  assert.deepEqual(fault.target, scenario.modelVersionId);
  assert.deepEqual(fault.startOffsetSeconds, { type: "integer", minimum: 0, maximum: 899 });
  assert.deepEqual(fault.durationSeconds, { type: "integer", minimum: 1, maximum: 900 });
  assert.deepEqual(fault.latencyMs, { type: ["integer", "null"], minimum: 0, maximum: 120_000 });
  assert.deepEqual(fault.responseCode, { type: ["integer", "null"], minimum: 100, maximum: 599 });
  assert.equal(scenario.journeyIds.minItems, 1);
  assert.equal(scenario.journeyIds.maxItems, 50);
  assert.deepEqual(scenario.journeyIds.items, scenario.modelVersionId);
  assert.deepEqual(thresholds.maxErrorRate, { type: "number", minimum: 0, maximum: 100 });
  assert.deepEqual(thresholds.maxP95LatencyMs, { type: "integer", minimum: 1, maximum: 120_000 });
  assert.deepEqual(thresholds.minJourneySuccess, { type: "number", minimum: 0, maximum: 100 });
  assert.deepEqual(scenario.cleanupPolicy.enum, ["always"]);
  assert.deepEqual(scenario.evidenceMode.enum, ["observed"]);
});
test("OpenAI campaign draft object schemas remain strict", () => {
  const visit = (schema, path = "draft_campaign") => {
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false, `${path} must reject extra properties`);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), `${path} must require every property`);
      for (const [key, property] of Object.entries(schema.properties)) visit(property, `${path}.${key}`);
    }
    if (schema.items) visit(schema.items, `${path}[]`);
  };
  visit(draftCampaignSchema);
});
test("authenticated WorldModel actions do not expose model creation", async () => {
  const source = await readFile(new URL("../app/api/v1/worldmodel/route.ts", import.meta.url), "utf8");
  assert.match(source, /const email = await requestIdentity\(request\)/);
  assert.match(source, /code === "unauthorized" \? 401/);
  assert.match(source, /readBoundedRequestText\(request, 262_144\)/);
  assert.match(source, /case "approve-model"/);
  assert.doesNotMatch(source, /case\s+["']create-model["']/);
  assert.doesNotMatch(source, /\bcreateModelVersion\b/);
});
test("Stripe verifies only bounded webhook bodies", async () => {
  const source = await readFile(new URL("../app/api/billing/webhook/route.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf('request.headers.get("stripe-signature")') < source.indexOf("readBoundedRequestText(request, 1_000_000)"));
  assert.match(source, /RequestBodyTooLargeError/);
  assert.match(source, /status: 413/);
});
test("environment and campaign approvals remain bound to approved model inputs", async () => {
  const source = await readFile(new URL("../db/product.ts", import.meta.url), "utf8");
  const saveEnvironment = source.match(/export async function saveEnvironment[\s\S]*?(?=export async function createJourney)/)?.[0] || "";
  const approveCampaign = source.match(/export async function approveCampaign[\s\S]*?(?=export async function cancelCampaign)/)?.[0] || "";

  assert.match(saveEnvironment, /model_versions WHERE id = \? AND workspace_id = \? AND project_id = \? AND status = 'approved'/);
  assert.match(approveCampaign, /JOIN model_versions mv[\s\S]*mv\.status = 'approved'/);
  assert.match(approveCampaign, /const manifest = validateManifest\(JSON\.parse\(String\(environment\.manifest_json\)\)\)/);
});
test("campaign approval limits journeys and fault targets to approved project membership", async () => {
  const source = await readFile(new URL("../db/product.ts", import.meta.url), "utf8");
  const approveCampaign = source.match(/export async function approveCampaign[\s\S]*?(?=export async function cancelCampaign)/)?.[0] || "";

  assert.match(approveCampaign, /user_journeys WHERE workspace_id = \? AND project_id = \? AND status = 'approved'/);
  assert.match(approveCampaign, /const allowedJourneys = new Set\(approvedJourneys\.results\.map/);
  assert.match(approveCampaign, /const allowedTargets = new Set\(\[[\s\S]*graph\.nodes[\s\S]*manifest\.services[\s\S]*manifest\.mocks/);
  assert.match(approveCampaign, /scenario\.journeyIds\.some\(\(journeyId\) => !allowedJourneys\.has\(journeyId\)\)/);
  assert.match(approveCampaign, /scenario\.faults\.some\(\(fault\) => !allowedTargets\.has\(fault\.target\)/);
});
test("campaign approval atomically reserves plan minutes only once", async () => {
  const source = await readFile(new URL("../db/product.ts", import.meta.url), "utf8");
  const approveCampaign = source.match(/export async function approveCampaign[\s\S]*?(?=export async function cancelCampaign)/)?.[0] || "";

  assert.match(approveCampaign, /const reservedMinutes = campaign\.approved_at \? 0 : plan\.estimatedMinutes/);
  assert.match(approveCampaign, /UPDATE workspaces SET simulation_minutes = simulation_minutes \+ \? WHERE id = \? AND simulation_minutes \+ \? <= \?/);
  assert.match(approveCampaign, /reservation\.meta\.changes/);
  assert.match(approveCampaign, /AND project_id = \? AND status = \?/);
  assert.match(approveCampaign, /claim\.meta\.changes/);
});
test("campaign cancellation conditionally transitions children and parent in one batch", async () => {
  const source = await readFile(new URL("../db/product.ts", import.meta.url), "utf8");
  const campaignRuns = await readFile(new URL("../worldmodel/campaign-runs.mjs", import.meta.url), "utf8");
  const cancelCampaign = source.match(/export async function cancelCampaign[\s\S]*?(?=export async function startInvestigation)/)?.[0] || "";

  assert.match(cancelCampaign, /const claimed = await requestCampaignCancellation\(db, campaignId, workspaceId, projectId, now\)/);
  assert.match(campaignRuns, /const \[, claimed\] = await db\.batch/);
  assert.match(campaignRuns, /UPDATE campaign_runs[\s\S]*EXISTS \(SELECT 1 FROM campaigns c[\s\S]*c\.status IN \('dispatching','queued','running'\)/);
  assert.match(campaignRuns, /UPDATE campaigns[\s\S]*AND project_id = \? AND status IN \('dispatching','queued','running'\)/);
  assert.match(campaignRuns, /claimed\?\.meta\?\.changes/);
});
test("candidate publication requires the exact approved artifact bytes", async () => {
  const encoded = new TextEncoder().encode(JSON.stringify({
    commitSha: "a".repeat(40),
    strategy: "minimal",
    files: [{ path: "src/retry.ts", content: "export const retries = 3;\n" }],
  }));
  const value = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  const sha256 = await candidateArtifactSha256(value);
  const candidate = await verifyCandidateArtifact(value, { sha256, sizeBytes: encoded.byteLength });
  assert.equal(candidate.commitSha, "a".repeat(40));
  assert.deepEqual(candidate.files.map((file) => file.path), ["src/retry.ts"]);
  await assert.rejects(verifyCandidateArtifact(value, { sha256: "b".repeat(64), sizeBytes: encoded.byteLength }), /digest/);
  await assert.rejects(verifyCandidateArtifact(value, { sha256, sizeBytes: encoded.byteLength + 1 }), /size/);

  const workflow = new TextEncoder().encode(JSON.stringify({
    commitSha: "a".repeat(40),
    strategy: "minimal",
    files: [{ path: ".github/workflows/release.yml", content: "name: release" }],
  }));
  const workflowValue = workflow.buffer.slice(workflow.byteOffset, workflow.byteOffset + workflow.byteLength);
  await assert.rejects(
    verifyCandidateArtifact(workflowValue, { sha256: await candidateArtifactSha256(workflowValue), sizeBytes: workflow.byteLength }),
    /prohibited/,
  );
});
test("decision approval binds publishing to redacted observed artifact metadata", async () => {
  const source = await readFile(new URL("../db/product.ts", import.meta.url), "utf8");
  assert.match(source, /sr\.status = 'verified' AND sr\.evidence_kind = 'observed'/);
  assert.match(source, /ea\.redacted = 1/);
  assert.match(source, /ra\.artifact_ref = ea\.id/);
  assert.match(source, /lower\(ra\.artifact_sha256\) = lower\(ea\.sha256\)/);
  assert.match(source, /verifyCandidateArtifact\(await object\.arrayBuffer\(\)/);
  assert.match(source, /Candidate commit is not the approved immutable model used by this observed run/);
});
test("draft PR publication uses a deterministic branch and a recoverable compare-and-swap lease", async () => {
  const source = await readFile(new URL("../db/product.ts", import.meta.url), "utf8");
  const publish = source.match(/export async function publishDecisionDraftPr[\s\S]*?(?=export async function sharedDecisionReport)/)?.[0] || "";
  const digest = "a".repeat(64);
  const branch = deterministicDraftPrBranch("Report_123", digest);

  assert.equal(branch, "worldmodel/report_123-aaaaaaaaaaaa");
  assert.equal(deterministicDraftPrBranch("Report_123", digest), branch);
  assert.notEqual(deterministicDraftPrBranch("Report_123", `b${digest.slice(1)}`), branch);
  assert.equal(draftPrPublicationLeaseExpired(null), true);
  assert.equal(draftPrPublicationLeaseExpired("invalid"), true);
  assert.equal(draftPrPublicationLeaseExpired(new Date(1_000).toISOString(), 1_000 + DRAFT_PR_PUBLICATION_LEASE_MS - 1), false);
  assert.equal(draftPrPublicationLeaseExpired(new Date(1_000).toISOString(), 1_000 + DRAFT_PR_PUBLICATION_LEASE_MS), true);
  assert.match(publish, /pr_branch = \?, pr_started_at = \?/);
  assert.match(publish, /coalesce\(pr_branch, ''\) = \? AND coalesce\(pr_started_at, ''\) = \?/);
  assert.match(publish, /pr_branch = \? AND pr_started_at = \? AND artifact_ref = \?/);
  assert.doesNotMatch(publish, /branchSuffix|crypto\.randomUUID/);
});
test("candidate hard gates cannot be bypassed by a high score", () => assert.equal(candidateScore({ resilienceImprovement: 100, regressionSafety: 100, complexity: 0, performance: 100, security: 100, evidenceConfidence: 100, hardGatesPassed: false }), 0));
test("campaign execution preflight requires the orchestrator, artifact store, and GitHub Actions runner", () => {
  const create = async () => ({ id: "workflow_1" });
  const put = async () => undefined;
  const fetch = async () => new Response();
  const base = { CAMPAIGN_ORCHESTRATOR: { create }, ARTIFACTS: { put } };
  assert.equal(evaluateCampaignExecutionReadiness({ ...base, GITHUB_ACTIONS_RUNNER: { fetch } }, "github_actions").ready, true);
  assert.equal(evaluateCampaignExecutionReadiness(base, "github_actions").ready, false);
  assert.deepEqual(evaluateCampaignExecutionReadiness(base, "github_actions").missing, ["GitHub Actions runner adapter"]);
  assert.equal(evaluateCampaignExecutionReadiness({ ...base, GITHUB_ACTIONS_RUNNER: { fetch } }, "unsupported_backend").ready, false);
});
test("local execution preflight returns an actionable setup state", () => {
  const result = evaluateCampaignExecutionReadiness({ LOCAL_DEVELOPMENT: "true" }, "github_actions");
  assert.equal(result.code, "runner_not_configured");
  assert.match(result.message, /local preview has no durable campaign orchestrator/i);
});
