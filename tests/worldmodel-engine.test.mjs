import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateResilience,
  checkOrderIntegrity,
  immutableScenario,
  scenarioProfiles,
  scanManifest,
  verifyReplay,
} from "../worldmodel/simulation-engine.mjs";
import { formatVerificationReport } from "../worldmodel/verification-report.mjs";
import { buildWorkspaceActivation } from "../worldmodel/activation.mjs";
import { normalizeObservedRun } from "../worldmodel/observed-run.mjs";
import { generateRunnerWorkflow } from "../worldmodel/runner-workflow.mjs";
import { buildRepositoryGraph } from "../worldmodel/repository-graph.mjs";
import { createHmac } from "node:crypto";
import {
  createStripePortalWithKey,
  verifyStripeSignature,
} from "../server/stripe.ts";
import {
  authorizedInstallation,
  publishGithubDraftEvidenceWithToken,
  repositoryTreeWithToken,
} from "../server/github.ts";
import { safeCsvCell } from "../worldmodel/safe-csv.mjs";
import { launchReadiness } from "../server/readiness.ts";
import {
  digestApiToken,
  generateApiTokenMaterial,
} from "../worldmodel/api-key-security.mjs";
import {
  resolveEntitlements,
  usagePeriod,
} from "../worldmodel/entitlements.mjs";
import {
  digestInvitationSecret,
  generateInvitationSecret,
} from "../worldmodel/invitation-security.mjs";
import {
  repairCanTransition,
  repairTransition,
} from "../worldmodel/repair-workflow.mjs";
import {
  githubDraftBody,
  githubEvidencePath,
  githubRepositoryParts,
} from "../worldmodel/github-pr-contract.mjs";
import { parseOperatorEmails, parseOperatorUserIds } from "../server/runtime-config.ts";
import { expectedRunnerWorkflowRef, runnerOidcClaimsMatch } from "../server/github-oidc.ts";
import { readBoundedRequestText, RequestBodyTooLargeError } from "../server/bounded-request-body.ts";

test("repository scanner detects seven evidenced components", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../sample-app/worldmodel.manifest.json", import.meta.url),
    ),
  );
  const components = scanManifest(manifest);
  assert.equal(components.length, 7);
  assert.ok(components.every((component) => component.evidence.length > 0));
  assert.ok(
    components.every((component) => component.confidence === "verified"),
  );
});

test("all three scenarios improve after the repair model", () => {
  for (const profile of Object.values(scenarioProfiles)) {
    assert.ok(profile.after.errors < profile.before.errors);
    assert.ok(profile.after.latencyMs < profile.before.latencyMs);
    assert.ok(profile.after.journeySuccess > profile.before.journeySuccess);
    assert.ok(
      calculateResilience(profile.after) > calculateResilience(profile.before),
    );
  }
});

test("verification replays the identical immutable scenario", () => {
  const replay = verifyReplay(immutableScenario, { ...immutableScenario });
  assert.equal(replay.identical, true);
  assert.equal(replay.before, replay.after);
});

test("order integrity rejects duplicate idempotency keys", () => {
  assert.deepEqual(
    checkOrderIntegrity([
      { idempotencyKey: "order-1" },
      { idempotencyKey: "order-2" },
    ]),
    { passed: true, duplicateOrders: 0, ordersChecked: 2 },
  );
  assert.equal(
    checkOrderIntegrity([
      { idempotencyKey: "order-1" },
      { idempotencyKey: "order-1" },
    ]).passed,
    false,
  );
});

test("verification report preserves immutable replay evidence and before-after metrics", () => {
  const report = formatVerificationReport({
    id: "run_test",
    project_name: "Checkout resilience",
    repository: "shopstream/demo-store",
    repository_verified: 1,
    evidence_kind: "observed",
    environment_id: "wm-ci-test-01",
    journey_runner: "playwright",
    environment_destroyed_at: "2026-07-13T23:43:00Z",
    before_service_health: 44,
    after_service_health: 98,
    branch: "main",
    scenario: "Payment outage",
    scenario_fingerprint: "scn_payment_503_45s_v1",
    seed: "seed_test",
    verified_at: "2026-07-13T23:42:00Z",
    before_score: 31,
    after_score: 94,
    before_error_rate: "32.1%",
    after_error_rate: "0.4%",
    before_latency_ms: 4060,
    after_latency_ms: 488,
    before_journey_success: 22,
    after_journey_success: 100,
  });
  assert.match(report, /Scenario fingerprint: scn_payment_503_45s_v1/);
  assert.match(report, /WORLDMODEL VERIFICATION REPORT/);
  assert.match(report, /OBSERVED EVIDENCE/);
  assert.match(report, /Environment ID: wm-ci-test-01/);
  assert.match(report, /Service health: 44% → 98%/);
  assert.match(report, /Resilience: 31 → 94/);
  assert.match(report, /Journey success: 22% → 100%/);
  assert.match(report, /ownership-validated tenant simulation record/);
});

test("manual repository reports disclose unverified ownership", () => {
  const report = formatVerificationReport({
    id: "run_manual",
    workspace_mode: "customer",
    repository_verified: 0,
    evidence_kind: "modeled",
    project_name: "Manual project",
    repository: "typed/by-hand",
    branch: "main",
    scenario: "Database slowdown",
  });
  assert.match(report, /UNVERIFIED REPOSITORY/);
  assert.match(report, /ownership has not been validated/);
  assert.match(report, /MODELED EVIDENCE/);
  assert.match(report, /Use this result for planning only/);
  assert.doesNotMatch(report, /ownership-validated tenant/);
});

test("sample verification reports cannot masquerade as customer evidence", () => {
  const report = formatVerificationReport({
    id: "run_sample",
    workspace_mode: "sample",
    project_name: "Checkout resilience",
    repository: "shopstream/demo-store",
    branch: "main",
    scenario: "Traffic spike",
    before_score: 42,
    after_score: 91,
  });
  assert.match(report, /WORLDMODEL SAMPLE VERIFICATION REPORT/);
  assert.match(report, /illustrative and is not evidence from a customer repository/);
  assert.match(report, /Create a clean customer workspace/);
  assert.doesNotMatch(report, /tenant-owned simulation record/);
});

test("customer activation advances only from persisted product milestones", () => {
  const workspace = {
    workspaceMode: "customer",
    projects: [{ id: "project_verified", repository_verified: 1, created_at: "2026-07-14T01:00:00Z" }],
    runs: [
      {
        status: "verified",
        evidence_kind: "observed",
        project_id: "project_verified",
        created_at: "2026-07-14T02:00:00Z",
        verified_at: "2026-07-14T02:05:00Z",
      },
    ],
    members: [{ created_at: "2026-07-14T00:00:00Z" }],
    invitations: [],
  };
  const activation = buildWorkspaceActivation(workspace);
  assert.equal(activation.percent, 75);
  assert.deepEqual(
    activation.steps.filter((step) => step.complete).map((step) => step.key),
    ["repository", "simulation", "verification"],
  );
  const unverified = buildWorkspaceActivation({
    ...workspace,
    projects: workspace.projects.map((project) => ({
      ...project,
      repository_verified: 0,
    })),
  });
  assert.equal(unverified.percent, 0);
  const modeledOnly = buildWorkspaceActivation({
    ...workspace,
    runs: workspace.runs.map((run) => ({
      ...run,
      evidence_kind: "modeled",
    })),
  });
  assert.equal(modeledOnly.percent, 50);
  assert.equal(modeledOnly.steps[2].complete, false);
  assert.equal(
    buildWorkspaceActivation({ ...workspace, workspaceMode: "sample" }),
    null,
  );
});

test("observed runner evidence requires a bounded destroyed environment attestation", () => {
  const payload = {
    action: "observe",
    projectId: "proj_verified_123",
    scenario: "database",
    fingerprint: "scn_database_800ms_v1",
    seed: "ci_seed_12345",
    environment: {
      id: "wm-ci-environment-123",
      destroyedAt: "2026-07-14T03:30:00Z",
    },
    journey: {
      runner: "playwright",
      name: "checkout",
      startedAt: "2026-07-14T03:27:00Z",
      endedAt: "2026-07-14T03:29:00Z",
    },
    before: {
      resilienceScore: 38,
      errorRate: 21.4,
      latencyMs: 3190,
      journeySuccess: 54,
      serviceHealth: 57,
    },
    after: {
      resilienceScore: 88,
      errorRate: 1.2,
      latencyMs: 734,
      journeySuccess: 98,
      serviceHealth: 96,
    },
  };
  const normalized = normalizeObservedRun(
    payload,
    Date.parse("2026-07-14T03:31:00Z"),
  );
  assert.equal(normalized.durationSeconds, 120);
  assert.equal(normalized.journeyRunner, "playwright");
  assert.equal(normalized.after.serviceHealth, 96);
  assert.throws(
    () => normalizeObservedRun({ ...payload, fingerprint: "wrong_fingerprint" }),
    /does not match/,
  );
  assert.throws(
    () =>
      normalizeObservedRun({
        ...payload,
        environment: {
          ...payload.environment,
          destroyedAt: "2026-07-14T04:00:00Z",
        },
      }, Date.parse("2026-07-14T03:31:00Z")),
    /cannot be in the future/,
  );
});

test("GitHub runner identity is bound to the generated workflow, branch, and dispatch event", () => {
  const input = { repository: "northstar/checkout-api", branch: "main", projectId: "proj_verified_123" };
  const workflowRef = expectedRunnerWorkflowRef(input.repository, input.branch, input.projectId);
  const workflowSha = "a".repeat(40);
  assert.equal(workflowRef, "northstar/checkout-api/.github/workflows/worldmodel-proj_verified_123.yml@refs/heads/main");
  assert.equal(runnerOidcClaimsMatch({ repository: input.repository, ref: "refs/heads/main", workflow_ref: workflowRef, workflow_sha: workflowSha, event_name: "workflow_dispatch" }, input), true);
  assert.equal(runnerOidcClaimsMatch({ repository: "northstar/other-api", ref: "refs/heads/main", workflow_ref: workflowRef, workflow_sha: workflowSha, event_name: "workflow_dispatch" }, input), false);
  assert.equal(runnerOidcClaimsMatch({ repository: input.repository, ref: "refs/heads/release", workflow_ref: workflowRef, workflow_sha: workflowSha, event_name: "workflow_dispatch" }, input), false);
  assert.equal(runnerOidcClaimsMatch({ repository: input.repository, ref: "refs/heads/main", workflow_ref: workflowRef.replace("worldmodel-", "other-"), workflow_sha: workflowSha, event_name: "workflow_dispatch" }, input), false);
  assert.equal(runnerOidcClaimsMatch({ repository: input.repository, ref: "refs/heads/main", workflow_ref: workflowRef, workflow_sha: workflowSha, event_name: "push" }, input), false);
  assert.equal(runnerOidcClaimsMatch({ repository: input.repository, ref: "refs/heads/main", workflow_ref: workflowRef, event_name: "workflow_dispatch" }, input), false);
  assert.equal(runnerOidcClaimsMatch({ repository: input.repository, ref: "refs/heads/main", workflow_ref: workflowRef, workflow_sha: "not-a-commit", event_name: "workflow_dispatch" }, input), false);
});

test("runner token route exposes workflow verification outages as retriable", async () => {
  const source = await readFile(new URL("../app/api/v1/runner/token/route.ts", import.meta.url), "utf8");
  assert.match(source, /runner_verification_unavailable/);
  assert.match(source, /verificationUnavailable \|\| message\.includes\("not configured"\)/);
  assert.match(source, /retriable: status === 503/);
});

test("runner workflow is tenant-project bound and contains no embedded secret", () => {
  const workflow = generateRunnerWorkflow({
    projectId: "proj_verified_123",
    apiOrigin: "https://worldmodel.example.com",
  });
  assert.match(workflow, /permissions:\n  contents: read\n  id-token: write/);
  assert.match(workflow, /--arg projectId "proj_verified_123"/);
  assert.match(workflow, /ACTIONS_ID_TOKEN_REQUEST_TOKEN/);
  assert.match(workflow, /api\/v1\/runner\/token/);
  assert.match(workflow, /WORLDMODEL_RUN_ID: \$\{\{ inputs\.run_id \}\}/);
  assert.match(workflow, /--arg runId "\$WORLDMODEL_RUN_ID"/);
  assert.match(workflow, /--data-binary @-/);
  assert.doesNotMatch(workflow, /--data '[^']*inputs\.run_id/);
  assert.doesNotMatch(workflow, /secrets\.WORLDMODEL_API_KEY/);
  assert.ok(workflow.indexOf("name: Authorize immutable execution") < workflow.indexOf("uses: actions/checkout@v4"));
  assert.match(workflow, /ref: \$\{\{ steps\.worldmodel\.outputs\.commit_sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node-version: \$\{\{ steps\.worldmodel\.outputs\.node_version \}\}/);
  assert.match(workflow, /WORLDMODEL_EXECUTION_SPEC: \$\{\{ runner\.temp \}\}\/worldmodel-execution\.json/);
  assert.match(workflow, /\.environment\.manifest\.install/);
  assert.match(workflow, /\.environment\.manifest\.observeCommand/);
  assert.match(workflow, /timeout --signal=TERM --kill-after=30s/);
  assert.match(workflow, /cmp --silent "\$WORLDMODEL_EXECUTION_SPEC" "\$FRESH_EXECUTION"/);
  assert.match(workflow, /scenarioFingerprint: \$execution\.scenarioFingerprint/);
  assert.match(workflow, /revisionId: \$execution\.environment\.id/);
  assert.equal(workflow.match(/ACTIONS_ID_TOKEN_REQUEST_TOKEN/g)?.length, 2);
  assert.doesNotMatch(workflow, /run: npm (ci|run worldmodel:observe)/);
  assert.doesNotMatch(workflow, /wm_live_/);
  assert.throws(
    () =>
      generateRunnerWorkflow({
        projectId: "../other-tenant",
        apiOrigin: "https://worldmodel.example.com",
      }),
    /Project ID is invalid/,
  );
  assert.throws(
    () =>
      generateRunnerWorkflow({
        projectId: "proj_verified_123",
        apiOrigin: "http://worldmodel.example.com",
      }),
    /API origin is invalid/,
  );
});

test("runner evidence body is capped by streamed UTF-8 bytes even without a trustworthy content length", async () => {
  const chunked = new Request("https://worldmodel.example/api/v1/runner/evidence", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abc"));
        controller.enqueue(new TextEncoder().encode("def"));
        controller.close();
      },
    }),
    duplex: "half",
    headers: { "content-length": "1" },
  });
  await assert.rejects(() => readBoundedRequestText(chunked, 5), RequestBodyTooLargeError);

  const multibyte = new Request("https://worldmodel.example/api/v1/runner/evidence", {
    method: "POST",
    body: "💥",
  });
  await assert.rejects(() => readBoundedRequestText(multibyte, 3), RequestBodyTooLargeError);
  assert.equal(await readBoundedRequestText(new Request("https://worldmodel.example", { method: "POST", body: "💥" }), 4), "💥");
});

test("runner evidence route marks persistence and configuration failures retriable", async () => {
  const source = await readFile(new URL("../app/api/v1/runner/evidence/route.ts", import.meta.url), "utf8");
  assert.match(source, /message\.startsWith\("runner_not_configured:"\)/);
  assert.match(source, /message\.startsWith\("evidence_persistence_failed:"\)/);
  assert.match(source, /unavailable \? 503 : serverFailure \? 500/);
  assert.match(source, /retriable: status >= 500/);
});

test("decision approval role checks reuse the workspace snapshot that selected the project", async () => {
  const source = await readFile(new URL("../db/product.ts", import.meta.url), "utf8");
  assert.match(source, /approveDecisionReport[\s\S]*?const \{ db, workspaceId, snapshot \} = await context\(email, projectId, true\); requireRole\(snapshot, \["owner", "admin"\]\)/);
  assert.match(source, /publishDecisionDraftPr[\s\S]*?const \{ db, workspaceId, project, snapshot \} = await context\(email, projectId, true\); requireRole\(snapshot, \["owner", "admin"\]\)/);
  assert.doesNotMatch(source, /requireRole\(\(await getSaasSnapshot\(email\)\), \["owner", "admin"\]\)/);
});

test("GitHub tree scanner builds an evidence-linked component graph", () => {
  const graph = buildRepositoryGraph(
    [
      { path: "package.json" },
      { path: "apps/web/package.json" },
      { path: "services/checkout/package.json" },
      { path: "services/checkout/src/index.ts" },
      { path: "packages/shared/package.json" },
      { path: "prisma/schema.prisma" },
      { path: "playwright.config.ts" },
      { path: "e2e/checkout.spec.ts" },
    ],
    { repository: "acme/store", branch: "main", truncated: false },
  );
  assert.equal(graph.source, "github_tree");
  assert.equal(graph.repository, "acme/store");
  assert.ok(graph.nodes.some((node) => node.path === "services/checkout"));
  assert.ok(graph.nodes.some((node) => node.kind === "datastore"));
  assert.ok(graph.nodes.some((node) => node.kind === "journey"));
  assert.ok(graph.nodes.every((node) => node.evidence.length > 0));
  assert.equal(graph.edges.length, graph.nodes.length - 1);
  const bounded = buildRepositoryGraph(
    Array.from({ length: 400 }, (_, index) => ({
      path: `services/service-${index}/package.json`,
    })),
  );
  assert.equal(bounded.nodes.length, 250);
});

test("GitHub tree fetch uses installation credentials and bounded tree entries", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const commitSha = "a".repeat(40);
    const treeSha = "b".repeat(40);
    const requests = [];
    globalThis.fetch = async (url, init) => {
      const request = { url: String(url), init };
      requests.push(request);
      if (request.url.includes("/git/ref/heads/main")) {
        return Response.json({ object: { sha: commitSha } });
      }
      if (request.url.includes(`/git/commits/${commitSha}`)) {
        return Response.json({ sha: commitSha, tree: { sha: treeSha } });
      }
      return new Response(
        JSON.stringify({
          sha: treeSha,
          truncated: false,
          tree: [
            { path: "package.json", type: "blob" },
            { path: "src", type: "tree" },
            { path: "ignored", type: "commit" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const tree = await repositoryTreeWithToken(
      "acme/store",
      "main",
      "installation-token",
    );
    assert.match(requests[0].url, /repos\/acme\/store\/git\/ref\/heads\/main$/);
    assert.match(requests[1].url, new RegExp(`/repos/acme/store/git/commits/${commitSha}$`));
    assert.match(requests[2].url, new RegExp(`/repos/acme/store/git/trees/${treeSha}\\?recursive=1$`));
    assert.equal(tree.commitSha, commitSha, "the immutable commit SHA must not be replaced by the tree SHA");
    assert.notEqual(tree.commitSha, treeSha);
    assert.ok(requests.every((request) => request.init.signal instanceof AbortSignal));
    assert.ok(requests.every((request) => request.init.headers.authorization === "Bearer installation-token"));
    assert.deepEqual(tree.entries.map((entry) => entry.path), ["package.json", "src"]);
    assert.equal(tree.truncated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub provider requests use a bounded deadline and return a safe timeout error", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  let receivedSignal;
  try {
    AbortSignal.timeout = () => AbortSignal.abort(new DOMException("fixture deadline", "TimeoutError"));
    globalThis.fetch = async (_url, init = {}) => {
      receivedSignal = init.signal;
      throw receivedSignal.reason;
    };
    await assert.rejects(
      repositoryTreeWithToken("acme/store", "main", "installation-token"),
      { message: "GitHub request timed out" },
    );
    assert.equal(receivedSignal.aborted, true);
  } finally {
    AbortSignal.timeout = originalTimeout;
    globalThis.fetch = originalFetch;
  }
});

test("Stripe webhook verification accepts only a fresh matching raw-body signature", async () => {
  const body = '{"id":"evt_verified","type":"checkout.session.completed"}';
  const secret = "whsec_test_worldmodel";
  const timestamp = 1_800_000_000;
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  assert.equal(
    await verifyStripeSignature(
      body,
      `t=${timestamp},v1=${digest}`,
      secret,
      timestamp + 30,
    ),
    true,
  );
  assert.equal(
    await verifyStripeSignature(
      `${body} `,
      `t=${timestamp},v1=${digest}`,
      secret,
      timestamp + 30,
    ),
    false,
  );
  assert.equal(
    await verifyStripeSignature(
      body,
      `t=${timestamp},v1=${digest}`,
      secret,
      timestamp + 301,
    ),
    false,
  );
});

test("Stripe billing portal uses a short-lived hosted session and rejects untrusted redirects", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = { url: String(url), init };
      return new Response(
        JSON.stringify({
          url: "https://billing.stripe.com/p/session/test_verified",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const url = await createStripePortalWithKey({
      customerId: "cus_verified",
      origin: "https://worldmodel.example",
      secretKey: "sk_test_secret",
    });
    assert.equal(url, "https://billing.stripe.com/p/session/test_verified");
    assert.equal(
      captured.url,
      "https://api.stripe.com/v1/billing_portal/sessions",
    );
    assert.equal(captured.init.headers.authorization, "Bearer sk_test_secret");
    assert.equal(captured.init.body.get("customer"), "cus_verified");
    assert.equal(
      captured.init.body.get("return_url"),
      "https://worldmodel.example/dashboard?billing=portal",
    );
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ url: "https://evil.example/steal" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await assert.rejects(
      createStripePortalWithKey({
        customerId: "cus_verified",
        origin: "https://worldmodel.example",
        secretKey: "sk_test_secret",
      }),
      /invalid billing portal URL/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Stripe provider requests use a bounded deadline and return a safe timeout error", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  let receivedSignal;
  try {
    AbortSignal.timeout = () => AbortSignal.abort(new DOMException("fixture deadline", "TimeoutError"));
    globalThis.fetch = async (_url, init = {}) => {
      receivedSignal = init.signal;
      throw receivedSignal.reason;
    };
    await assert.rejects(
      createStripePortalWithKey({
        customerId: "cus_verified",
        origin: "https://worldmodel.example",
        secretKey: "sk_test_secret",
      }),
      { message: "Stripe request timed out" },
    );
    assert.equal(receivedSignal.aborted, true);
  } finally {
    AbortSignal.timeout = originalTimeout;
    globalThis.fetch = originalFetch;
  }
});

test("GitHub connection accepts only an installation visible to the authorized user", () => {
  const installations = [
    {
      id: 42,
      account: { login: "northstar", type: "Organization" },
      repository_selection: "selected",
      permissions: { contents: "read" },
    },
  ];
  assert.equal(
    authorizedInstallation(installations, "42")?.account.login,
    "northstar",
  );
  assert.equal(authorizedInstallation(installations, "999"), null);
});

test("audit CSV export neutralizes spreadsheet formulas and escapes quotes", () => {
  assert.equal(
    safeCsvCell('=HYPERLINK("https://evil.test")'),
    '"\'=HYPERLINK(""https://evil.test"")"',
  );
  assert.equal(safeCsvCell('review "ready"'), '"review ""ready"""');
});

test("commercial launch gate is derived from live state and owner attestations", () => {
  const baselineInput = {
    projects: [{}],
    runs: [{ status: "verified", evidence_kind: "observed" }],
    githubInstallations: [],
    subscription: null,
    auditAccess: false,
    launchChecks: [
      {
        check_key: "legal_review",
        passed: 1,
        evidence: "Counsel review 2026-07-13",
      },
      {
        check_key: "security_review",
        passed: 1,
        evidence: "Independent assessment",
      },
      {
        check_key: "incident_plan",
        passed: 1,
        evidence: "Runbook owner assigned",
      },
      {
        check_key: "support_owner",
        passed: 1,
        evidence: "Support owner assigned",
      },
    ],
    configuration: {
      github: { configured: false },
      billing: { configured: false },
    },
  };
  const baseline = launchReadiness(baselineInput);
  assert.equal(baseline.passed, 8);
  assert.equal(baseline.total, 12);
  assert.equal(baseline.ready, false);
  assert.match(
    baseline.checks.find((check) => check.key === "github_live").evidence,
    /credentials are missing/,
  );
  for (const runs of [
    [{ status: "verified", evidence_kind: "modeled" }],
    [{ status: "running", evidence_kind: "observed" }],
  ]) {
    const evidenceMismatch = launchReadiness({ ...baselineInput, runs });
    assert.equal(evidenceMismatch.checks.find((check) => check.key === "verified_replay").passed, false);
    assert.equal(evidenceMismatch.passed, baseline.passed - 1);
  }

  const ready = launchReadiness({
    projects: [{}],
    runs: [{ status: "verified", evidence_kind: "observed" }],
    githubInstallations: [{}],
    subscription: { status: "active" },
    auditAccess: true,
    launchChecks: baseline.checks
      .filter((check) => check.source === "attested")
      .map((check) => ({
        check_key: check.key,
        passed: 1,
        evidence: check.evidence,
      })),
    configuration: {
      github: { configured: true },
      billing: { configured: true },
      intelligence: { configured: true },
      execution: { campaignOrchestrator: true, artifacts: true, githubActionsRunner: true },
    },
  });
  assert.equal(ready.score, 100);
  assert.equal(ready.ready, true);
});

test("developer runs endpoint cannot accept self-attested observed or verified metrics", async () => {
  const source = await readFile(new URL("../app/api/v1/runs/route.ts", import.meta.url), "utf8");
  assert.match(source, /payload\.action === "observe" \|\| payload\.action === "verify"/);
  assert.match(source, /code: "signed_runner_required"/);
  assert.match(source, /createSimulationRunForWorkspace\(context\.workspaceId, context\.actor, scenario, payload\.projectId\)/);
  assert.doesNotMatch(source, /normalizeObservedRun|ingestObservedRunForWorkspace/);
});

test("product and operator evidence consumers require verified observed runs", async () => {
  const [productSource, operatorSource] = await Promise.all([
    readFile(new URL("../db/product.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/operator.ts", import.meta.url), "utf8"),
  ]);
  assert.match(productSource, /WHERE r\.project_id = \? AND p\.workspace_id = \? AND r\.status = 'verified' AND r\.evidence_kind = 'observed'/);
  assert.match(productSource, /!run \|\| run\.status !== "verified" \|\| run\.evidence_kind !== "observed"/);
  const verifiedObservedCounters = operatorSource.match(/r\.status = 'verified' AND r\.evidence_kind = 'observed'/g) || [];
  assert.ok(verifiedObservedCounters.length >= 3);
});

test("developer API credentials use one-time high-entropy material and irreversible stored digests", async () => {
  const first = generateApiTokenMaterial("key_securitytest");
  const second = generateApiTokenMaterial("key_securitytest");
  assert.match(first.token, /^wm_live_key_securitytest_[a-f0-9]{64}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.keyPrefix, "wm_live_key_securitytest_…");
  const digest = await digestApiToken(first.token);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.ok(!digest.includes(first.token));
});

test("workspace invitations use unique one-time secrets and irreversible stored digests", async () => {
  const first = generateInvitationSecret("inv_securitytest");
  const second = generateInvitationSecret("inv_securitytest");
  assert.match(first, /^wmi_inv_securitytest_[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  const digest = await digestInvitationSecret(first);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.ok(!digest.includes(first));
});

test("repair review state machine gates decisions and pull request handoff", () => {
  assert.equal(
    repairTransition("ready_for_review", "request-review"),
    "in_review",
  );
  assert.equal(
    repairTransition("changes_requested", "request-review"),
    "in_review",
  );
  assert.equal(repairTransition("in_review", "approve"), "approved");
  assert.equal(
    repairTransition("in_review", "request-changes"),
    "changes_requested",
  );
  assert.equal(repairTransition("approved", "prepare-pr"), "pr_ready");
  assert.equal(repairCanTransition("ready_for_review", "prepare-pr"), false);
  assert.throws(() => repairTransition("pr_ready", "approve"), /not allowed/);
});

test("GitHub draft handoff contract validates repository paths and preserves approval evidence", () => {
  assert.deepEqual(githubRepositoryParts("northstar/checkout-api"), {
    owner: "northstar",
    repository: "checkout-api",
  });
  assert.throws(
    () => githubRepositoryParts("https://github.com/northstar/checkout-api"),
    /invalid/,
  );
  assert.equal(
    githubEvidencePath("repair_payment_123"),
    ".worldmodel/repairs/repair_payment_123.json",
  );
  assert.throws(() => githubEvidencePath("../secrets"), /invalid/);
  const body = githubDraftBody({
    repair: {
      title: "Graceful payment recovery",
      residualRisks: ["Regional failover remains unverified"],
    },
    scenario: {
      name: "Payment outage",
      fingerprint: "scn_payment_503_45s_v1",
      evidenceKind: "modeled",
      beforeScore: 31,
      afterScore: 94,
      verifiedAt: "2026-07-13T23:42:00Z",
    },
    review: {
      approvedBy: "owner@example.com",
      approvedAt: "2026-07-14T02:00:00Z",
      decisionNote: "Replay and regression evidence reviewed.",
    },
  });
  assert.match(body, /intentionally a draft/);
  assert.match(body, /MODELED EVIDENCE/);
  assert.match(body, /were not observed/);
  assert.match(body, /31 → 94/);
  assert.match(body, /owner@example.com/);
  assert.match(body, /Regional failover remains unverified/);
});

test("GitHub draft publisher creates branch, commits evidence, opens a draft, and reuses an existing PR", async () => {
  const originalFetch = globalThis.fetch;
  const input = {
    installationId: "42",
    owner: "northstar",
    repository: "checkout-api",
    baseBranch: "main",
    headBranch: "worldmodel/repair-run-1",
    evidencePath: ".worldmodel/repairs/repair_run_1.json",
    title: "draft: graceful recovery",
    body: "Verified evidence",
    evidence: '{"verified":true}',
  };
  try {
    const requests = [];
    const responses = [
      [200, { object: { sha: "base-sha" } }],
      [404, { message: "Not Found" }],
      [201, { ref: "refs/heads/worldmodel/repair-run-1" }],
      [404, { message: "Not Found" }],
      [201, { content: { sha: "evidence-sha" } }],
      [200, []],
      [
        201,
        {
          number: 248,
          html_url: "https://github.com/northstar/checkout-api/pull/248",
          draft: true,
        },
      ],
    ];
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      const [status, body] = responses.shift();
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    };
    const created = await publishGithubDraftEvidenceWithToken(
      input,
      "installation-secret",
    );
    assert.equal(created.number, 248);
    assert.equal(requests.length, 7);
    const refRequest = JSON.parse(requests[2].init.body);
    assert.deepEqual(refRequest, {
      ref: "refs/heads/worldmodel/repair-run-1",
      sha: "base-sha",
    });
    const contentRequest = JSON.parse(requests[4].init.body);
    assert.equal(
      Buffer.from(contentRequest.content, "base64").toString(),
      input.evidence,
    );
    const pullRequest = JSON.parse(requests[6].init.body);
    assert.equal(pullRequest.draft, true);
    assert.equal(pullRequest.head, input.headBranch);
    assert.ok(
      requests.every(
        (request) =>
          request.init.headers.authorization === "Bearer installation-secret",
      ),
    );

    const retryRequests = [];
    const retryResponses = [
      [200, { object: { sha: "base-sha" } }],
      [200, { object: { sha: "head-sha" } }],
      [200, { sha: "old-evidence-sha" }],
      [200, { content: { sha: "new-evidence-sha" } }],
      [
        200,
        [
          {
            number: 248,
            html_url: "https://github.com/northstar/checkout-api/pull/248",
            draft: true,
          },
        ],
      ],
    ];
    globalThis.fetch = async (url, init = {}) => {
      retryRequests.push({ url: String(url), init });
      const [status, body] = retryResponses.shift();
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    };
    const reused = await publishGithubDraftEvidenceWithToken(
      input,
      "installation-secret",
    );
    assert.equal(reused.number, 248);
    assert.equal(retryRequests.length, 5);
    assert.equal(
      JSON.parse(retryRequests[3].init.body).sha,
      "old-evidence-sha",
    );
    assert.equal(
      retryRequests.some(
        (request) =>
          request.url.endsWith("/pulls") && request.init.method === "POST",
      ),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operator access allowlist is explicit, normalized, and rejects malformed identities", () => {
  const configured = parseOperatorEmails(
    " Owner@Example.com,ops@example.com, invalid, ,owner@example.com ",
  );
  assert.deepEqual([...configured], ["owner@example.com", "ops@example.com"]);
  assert.equal(parseOperatorEmails(undefined).size, 0);
  assert.deepEqual(
    [...parseOperatorUserIds("usr_0123456789abcdef0123456789abcdef, invalid, usr_FEDCBA9876543210FEDCBA9876543210")],
    ["usr_0123456789abcdef0123456789abcdef", "usr_FEDCBA9876543210FEDCBA9876543210"],
  );
  assert.equal(parseOperatorUserIds(undefined).size, 0);
});

test("commercial entitlements follow trial, paid, delinquent, and canceled lifecycle states", () => {
  const now = new Date("2026-07-13T12:00:00Z");
  const workspace = { trial_ends_at: "2026-07-20T12:00:00Z" };
  const trial = resolveEntitlements({ workspace, subscription: null, now });
  assert.equal(trial.planKey, "pro_trial");
  assert.equal(trial.trialDaysRemaining, 7);
  assert.deepEqual(trial.limits, {
    simulationMinutes: 500,
    projects: 10,
    seats: 5,
    apiKeys: 2,
  });

  const starter = resolveEntitlements({
    workspace,
    subscription: { status: "active", plan: "starter" },
    now,
  });
  assert.equal(starter.planKey, "starter");
  assert.equal(starter.canWrite, true);
  assert.deepEqual(starter.limits, {
    simulationMinutes: 150,
    projects: 3,
    seats: 1,
    apiKeys: 2,
  });

  const delinquent = resolveEntitlements({
    workspace,
    subscription: { status: "past_due", plan: "pro" },
    now,
  });
  assert.equal(delinquent.planKey, "pro");
  assert.equal(delinquent.access, "read_only");
  assert.equal(delinquent.canWrite, false);

  const canceled = resolveEntitlements({
    workspace,
    subscription: { status: "canceled", plan: "pro" },
    now,
  });
  assert.equal(canceled.planKey, "free");
  assert.equal(canceled.limits.apiKeys, 0);
});

test("usage periods roll over on calendar-month boundaries", () => {
  assert.deepEqual(usagePeriod(new Date("2026-12-31T23:59:59Z")), {
    start: "2026-12-01T00:00:00.000Z",
    end: "2027-01-01T00:00:00.000Z",
  });
});
