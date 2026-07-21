import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

process.env.WORLDMODEL_LOCAL_RUNTIME = "true";
process.env.WORLDMODEL_LOCAL_STATE_DIR = path.join(
  tmpdir(),
  `worldmodel-workspace-onboarding-${process.pid}-${crypto.randomUUID()}`,
);
process.env.RUNNER_TOKEN_SECRET = "runner-test-secret-with-at-least-thirty-two-bytes";

const base64url = (value) => Buffer.from(value).toString("base64url");

async function signRunnerToken({ workspaceId, projectId, runId, repository, jti = crypto.randomUUID() }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ workspaceId, projectId, runId, repository, iat: issuedAt, exp: issuedAt + 900, jti }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(process.env.RUNNER_TOKEN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

async function signGithubOidc(claims) {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const kid = `runner-test-${crypto.randomUUID()}`;
  const header = base64url(JSON.stringify({ alg: "RS256", kid }));
  const payload = base64url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return {
    token: `${header}.${payload}.${base64url(new Uint8Array(signature))}`,
    jwk: { ...await crypto.subtle.exportKey("jwk", pair.publicKey), kid },
  };
}

async function ensureRunnerTestSchema(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS model_versions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, commit_sha TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', graph_json TEXT NOT NULL DEFAULT '{}', confidence INTEGER NOT NULL DEFAULT 0, scan_version TEXT NOT NULL DEFAULT 'wm-ts-1', user_overrides_json TEXT NOT NULL DEFAULT '{}', approved_by TEXT, approved_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS environment_revisions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, model_version_id TEXT NOT NULL, backend TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', manifest_json TEXT NOT NULL, validation_json TEXT NOT NULL DEFAULT '{}', approved_by TEXT, approved_at TEXT, snapshot_ref TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, conversation_id TEXT, name TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', plan_json TEXT NOT NULL, estimated_minutes INTEGER NOT NULL, concurrency INTEGER NOT NULL, approved_by TEXT, approved_at TEXT, workflow_id TEXT, cancellation_requested_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS campaign_runs (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, scenario_index INTEGER NOT NULL, scenario_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', simulation_run_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE TABLE IF NOT EXISTS run_events (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, run_id TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL, source TEXT NOT NULL, service_id TEXT, journey_id TEXT, payload_json TEXT NOT NULL DEFAULT '{}', evidence_ref TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS run_events_sequence_idx ON run_events(run_id, sequence)"),
  ]);
}

async function runnerFixture({ runStatus = "queued", campaignStatus = "queued" } = {}) {
  const { createProject, provisionCustomerWorkspace } = await import("../db/saas.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  const unique = crypto.randomUUID().replaceAll("-", "");
  const email = `runner.${unique}@example.test`;
  const provisioned = await provisionCustomerWorkspace(email, "Runner Evidence");
  const repository = `example/runner-${unique.slice(0, 12)}`;
  const project = await createProject(email, { name: "Runner Evidence", repository, branch: "main", sourceKind: "github", repositoryVerified: true });
  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);
  await ensureRunnerTestSchema(db);
  const modelId = `model_${unique.slice(0, 24)}`;
  const environmentId = `env_${unique.slice(0, 24)}`;
  const journeyId = `journey_${unique.slice(0, 20)}`;
  const campaignId = `campaign_${unique.slice(0, 20)}`;
  const runId = `crun_${unique.slice(0, 24)}`;
  const scenario = {
    name: "Checkout traffic surge",
    modelVersionId: modelId,
    environmentRevisionId: environmentId,
    seed: `seed_${unique.slice(0, 20)}`,
    durationSeconds: 60,
    workload: { baselineRps: 2, peakMultiplier: 10, rampSeconds: 5 },
    faults: [{ kind: "traffic_surge", target: "web", startOffsetSeconds: 5, durationSeconds: 30 }],
    journeyIds: [journeyId],
    thresholds: { maxErrorRate: 2, maxP95LatencyMs: 800, minJourneySuccess: 99 },
    cleanupPolicy: "always",
    evidenceMode: "observed",
  };
  const manifest = {
    version: 1,
    packageManager: "npm",
    nodeVersion: "22",
    install: "npm ci",
    observeCommand: "npm run worldmodel:observe",
    services: [{ id: "web", name: "Web", root: ".", start: "npm run dev", port: 3000, healthCheck: "/health", dependsOn: [] }],
    testCommands: ["npm test"],
    journeyCommands: ["npx playwright test"],
    mocks: [],
    secretRefs: [],
    supportedFaults: ["traffic_surge"],
    resources: { cpu: 1, memoryMb: 1024, timeoutSeconds: 300, network: "registries" },
  };
  await db.batch([
    db.prepare("INSERT INTO model_versions (id, workspace_id, project_id, commit_sha, status, approved_by, approved_at) VALUES (?, ?, ?, ?, 'approved', ?, ?)").bind(modelId, provisioned.workspace.id, project.id, "a".repeat(40), email, new Date().toISOString()),
    db.prepare("INSERT INTO environment_revisions (id, workspace_id, project_id, model_version_id, backend, status, manifest_json, approved_by, approved_at) VALUES (?, ?, ?, ?, 'github_actions', 'approved', ?, ?, ?)").bind(environmentId, provisioned.workspace.id, project.id, modelId, JSON.stringify(manifest), email, new Date().toISOString()),
    db.prepare("INSERT INTO campaigns (id, workspace_id, project_id, name, objective, status, plan_json, estimated_minutes, concurrency) VALUES (?, ?, ?, 'Runner campaign', 'Verify resilience', ?, '{}', 1, 1)").bind(campaignId, provisioned.workspace.id, project.id, campaignStatus),
    db.prepare("INSERT INTO campaign_runs (id, campaign_id, workspace_id, project_id, scenario_index, scenario_json, status) VALUES (?, ?, ?, ?, 0, ?, ?)").bind(runId, campaignId, provisioned.workspace.id, project.id, JSON.stringify(scenario), runStatus),
  ]);
  return { db, workspaceId: provisioned.workspace.id, projectId: project.id, repository, modelId, environmentId, journeyId, campaignId, runId, scenario, manifest };
}

async function observedEvidence(fixture) {
  const { immutableScenario } = await import("../worldmodel/runner-evidence.ts");
  const immutable = await immutableScenario(fixture.scenario);
  const now = Date.now();
  return {
    action: "observe",
    projectId: fixture.projectId,
    scenarioFingerprint: immutable.fingerprint,
    seed: fixture.scenario.seed,
    environment: { id: `runtime-${crypto.randomUUID()}`, revisionId: fixture.environmentId, destroyedAt: new Date(now - 1_000).toISOString() },
    journey: { id: fixture.journeyId, runner: "playwright", name: "Checkout journey", startedAt: new Date(now - 21_000).toISOString(), endedAt: new Date(now - 2_000).toISOString() },
    before: { resilienceScore: 42, errorRate: 12.5, latencyMs: 3_200, journeySuccess: 60, serviceHealth: 55 },
    after: { resilienceScore: 91, errorRate: 1.2, latencyMs: 640, journeySuccess: 99, serviceHealth: 96 },
  };
}

test("customer onboarding uses random IDs and isolates legacy hash collisions", async () => {
  const { ensureSaasSchema, provisionCustomerWorkspace } = await import("../db/saas.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  await ensureSaasSchema();

  // These distinct addresses collide under the previous 32-bit FNV suffix.
  const firstEmail = "glrw6n-obkcaq@example.test";
  const secondEmail = "zd4pad-1uo6tnk@example.test";
  const first = await provisionCustomerWorkspace(firstEmail, "First Customer");
  const second = await provisionCustomerWorkspace(secondEmail, "Second Customer");

  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.match(first.workspace.id, /^ws_[0-9a-f]{32}$/);
  assert.match(second.workspace.id, /^ws_[0-9a-f]{32}$/);
  assert.notEqual(first.workspace.id, second.workspace.id);

  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);
  const memberships = await db.prepare("SELECT workspace_id, email, role FROM workspace_members WHERE lower(email) IN (?, ?) ORDER BY email").bind(firstEmail, secondEmail).all();
  assert.deepEqual(memberships.results.map((row) => ({ ...row })), [
    { workspace_id: first.workspace.id, email: firstEmail, role: "owner" },
    { workspace_id: second.workspace.id, email: secondEmail, role: "owner" },
  ]);
});

test("customer onboarding is idempotent for an existing owner", async () => {
  const { provisionCustomerWorkspace } = await import("../db/saas.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  const email = `owner.${crypto.randomUUID()}@example.test`;

  const first = await provisionCustomerWorkspace(email, "Original Name");
  const repeated = await provisionCustomerWorkspace(email.toUpperCase(), "Replacement Name");

  assert.equal(first.created, true);
  assert.equal(repeated.created, false);
  assert.equal(repeated.workspace.id, first.workspace.id);
  assert.equal(repeated.workspace.name, "Original Name");

  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);
  const workspaces = await db.prepare("SELECT id FROM workspaces WHERE lower(owner_email) = lower(?) AND workspace_mode = 'customer'").bind(email).all();
  const memberships = await db.prepare("SELECT workspace_id FROM workspace_members WHERE lower(email) = lower(?) AND role = 'owner'").bind(email).all();
  assert.deepEqual(workspaces.results.map((row) => ({ ...row })), [{ id: first.workspace.id }]);
  assert.deepEqual(memberships.results.map((row) => ({ ...row })), [{ workspace_id: first.workspace.id }]);
});

test("atomic quota SQL caps API keys and invitation seats across parallel attempts", async () => {
  const { createApiKeyWithinLimitSql } = await import("../db/developer-api.ts");
  const { acceptInvitationWithinSeatLimitSql, createInvitationWithinSeatLimitSql } = await import("../db/team.ts");
  const { provisionCustomerWorkspace } = await import("../db/saas.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  const unique = crypto.randomUUID().replaceAll("-", "");
  const owner = `quota.${unique}@example.test`;
  const provisioned = await provisionCustomerWorkspace(owner, "Atomic Quotas");
  const workspaceId = provisioned.workspace.id;
  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);

  const apiAttempts = await Promise.all(Array.from({ length: 8 }, (_, index) => db.prepare(createApiKeyWithinLimitSql).bind(
    `key_${unique}_${index}`,
    workspaceId,
    `Parallel key ${index}`,
    `wma_parallel_${index}`,
    `hash_${unique}_${index}`,
    JSON.stringify(["runs:read"]),
    owner,
    null,
    workspaceId,
    2,
  ).run()));
  assert.equal(apiAttempts.reduce((total, result) => total + Number(result.meta.changes || 0), 0), 2);
  const activeKeys = await db.prepare("SELECT COUNT(*) AS count FROM api_keys WHERE workspace_id = ? AND status = 'active'").bind(workspaceId).first();
  assert.equal(activeKeys.count, 2);

  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const invitationAttempts = await Promise.all(Array.from({ length: 8 }, (_, index) => {
    const invitee = `invitee.${unique}.${index}@example.test`;
    return db.prepare(createInvitationWithinSeatLimitSql).bind(
      `inv_${unique}_${index}`,
      workspaceId,
      invitee,
      "member",
      `token_${unique}_${index}`,
      owner,
      expiresAt,
      workspaceId,
      invitee,
      workspaceId,
      workspaceId,
      3,
    ).run();
  }));
  assert.equal(invitationAttempts.reduce((total, result) => total + Number(result.meta.changes || 0), 0), 2);
  const pending = await db.prepare("SELECT id, email FROM workspace_invitations WHERE workspace_id = ? AND status = 'pending' ORDER BY id").bind(workspaceId).all();
  assert.equal(pending.results.length, 2);

  const acceptanceAttempts = await Promise.all(pending.results.map((invitation) => db.prepare(acceptInvitationWithinSeatLimitSql).bind(
    invitation.id,
    workspaceId,
    invitation.email,
    workspaceId,
    invitation.email,
    workspaceId,
    2,
  ).run()));
  assert.equal(acceptanceAttempts.reduce((total, result) => total + Number(result.meta.changes || 0), 0), 1);
  const members = await db.prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ?").bind(workspaceId).first();
  assert.equal(members.count, 2);
});

test("modeled-run minute reservations are bounded and stale period resets cannot erase them", async () => {
  const {
    createProject,
    createSimulationRunForWorkspace,
    provisionCustomerWorkspace,
    reserveModeledRunMinutesSql,
    resetWorkspaceUsagePeriodSql,
  } = await import("../db/saas.ts");
  const { usagePeriod } = await import("../worldmodel/entitlements.mjs");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  const unique = crypto.randomUUID().replaceAll("-", "");
  const owner = `minutes.${unique}@example.test`;
  const provisioned = await provisionCustomerWorkspace(owner, "Atomic Minutes");
  const project = await createProject(owner, { name: "Quota Project", repository: `example/quota-${unique}`, branch: "main" });
  const workspaceId = provisioned.workspace.id;
  const period = usagePeriod();
  const priorPeriod = new Date(Date.parse(period.start) - 86_400_000).toISOString();
  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);

  await db.prepare("UPDATE workspaces SET simulation_minutes = 17, usage_period_start = ? WHERE id = ?").bind(priorPeriod, workspaceId).run();
  const firstReset = await db.prepare(resetWorkspaceUsagePeriodSql).bind(period.start, workspaceId, period.start).run();
  const firstReservation = await db.prepare(reserveModeledRunMinutesSql).bind(2, workspaceId, period.start, 2, 50).run();
  const staleReset = await db.prepare(resetWorkspaceUsagePeriodSql).bind(period.start, workspaceId, period.start).run();
  assert.deepEqual([firstReset.meta.changes, firstReservation.meta.changes, staleReset.meta.changes], [1, 1, 0]);
  const usageAfterStaleReset = await db.prepare("SELECT simulation_minutes FROM workspaces WHERE id = ?").bind(workspaceId).first();
  assert.equal(usageAfterStaleReset.simulation_minutes, 2);

  await db.prepare("UPDATE workspaces SET trial_ends_at = ?, simulation_minutes = 48, monthly_limit = 50, usage_period_start = ? WHERE id = ?").bind(new Date(Date.now() - 86_400_000).toISOString(), period.start, workspaceId).run();
  const runAttempts = await Promise.allSettled(Array.from({ length: 8 }, () => createSimulationRunForWorkspace(workspaceId, owner, "traffic", project.id)));
  const fulfilled = runAttempts.filter((result) => result.status === "fulfilled");
  const rejected = runAttempts.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 7);
  for (const result of rejected) assert.match(String(result.reason?.message || result.reason), /Monthly simulation minute limit reached/);
  const finalUsage = await db.prepare("SELECT simulation_minutes FROM workspaces WHERE id = ?").bind(workspaceId).first();
  const runs = await db.prepare("SELECT COUNT(*) AS count FROM simulation_runs WHERE project_id = ? AND evidence_kind = 'modeled'").bind(project.id).first();
  assert.equal(finalUsage.simulation_minutes, 50);
  assert.equal(runs.count, 1);
});

test("customer onboarding preserves an existing legacy workspace ID", async () => {
  const { ensureSaasSchema, provisionCustomerWorkspace } = await import("../db/saas.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  await ensureSaasSchema();
  const email = `legacy.${crypto.randomUUID()}@example.test`;
  const legacyId = "ws_legacy_1wlfuqz";
  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);
  await db.batch([
    db.prepare("INSERT INTO workspaces (id, name, owner_email, workspace_mode) VALUES (?, 'Legacy Workspace', ?, 'customer')").bind(legacyId, email),
    db.prepare("INSERT INTO workspace_members (workspace_id, email, role) VALUES (?, ?, 'owner')").bind(legacyId, email),
  ]);

  const provisioned = await provisionCustomerWorkspace(email, "Do Not Rename");
  assert.equal(provisioned.created, false);
  assert.equal(provisioned.workspace.id, legacyId);
  assert.equal(provisioned.workspace.name, "Legacy Workspace");
});

test("GitHub App installations and repositories stay isolated across workspaces", async () => {
  const { githubConnectionStatements, requireImportableGithubRepository } = await import("../db/github-app.ts");
  const { ensureSaasSchema, getSaasSnapshot, provisionCustomerWorkspace } = await import("../db/saas.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  await ensureSaasSchema();

  const firstEmail = `github.first.${crypto.randomUUID()}@example.test`;
  const secondEmail = `github.second.${crypto.randomUUID()}@example.test`;
  const first = await provisionCustomerWorkspace(firstEmail, "GitHub First");
  const second = await provisionCustomerWorkspace(secondEmail, "GitHub Second");
  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);

  const installation = {
    id: 987654,
    account: { login: "shared-engineering-org", type: "Organization" },
    repository_selection: "selected",
    permissions: { contents: "write", pull_requests: "write" },
  };
  const sharedRepository = { id: 456789, full_name: "shared-engineering-org/shared", default_branch: "main", private: true };
  const firstOnlyRepository = { id: 456790, full_name: "shared-engineering-org/first-only", default_branch: "main", private: true };
  await db.batch(githubConnectionStatements(db, first.workspace.id, firstEmail, installation, [sharedRepository, firstOnlyRepository]));

  const secondBeforeConnection = await getSaasSnapshot(secondEmail);
  assert.deepEqual(secondBeforeConnection.githubInstallations, []);
  assert.deepEqual(secondBeforeConnection.githubRepositories, []);
  await assert.rejects(
    () => requireImportableGithubRepository(db, second.workspace.id, String(firstOnlyRepository.id)),
    /not found in this workspace/,
  );
  assert.throws(
    () => db.prepare("INSERT INTO github_workspace_repositories (workspace_id, repository_id, installation_id, full_name, default_branch) VALUES (?, 'cross-tenant-row', ?, 'shared-engineering-org/forged', 'main')").bind(second.workspace.id, String(installation.id)).run(),
    /FOREIGN KEY constraint failed/,
  );

  await db.batch(githubConnectionStatements(db, second.workspace.id, secondEmail, installation, [sharedRepository]));

  await db.prepare("UPDATE github_workspace_repositories SET selected = 1 WHERE workspace_id = ? AND repository_id = ?").bind(second.workspace.id, String(sharedRepository.id)).run();
  const firstSnapshot = await getSaasSnapshot(firstEmail);
  const secondSnapshot = await getSaasSnapshot(secondEmail);

  assert.equal(firstSnapshot.githubInstallations.length, 1);
  assert.equal(secondSnapshot.githubInstallations.length, 1);
  assert.equal(firstSnapshot.githubInstallations[0].installation_id, String(installation.id));
  assert.equal(secondSnapshot.githubInstallations[0].installation_id, String(installation.id));
  assert.deepEqual(firstSnapshot.githubRepositories.map((repository) => repository.full_name).sort(), [
    firstOnlyRepository.full_name,
    sharedRepository.full_name,
  ]);
  assert.deepEqual(secondSnapshot.githubRepositories.map((repository) => repository.full_name), [sharedRepository.full_name]);
  assert.equal(firstSnapshot.githubRepositories.find((repository) => repository.repository_id === String(sharedRepository.id))?.selected, 0);
  assert.equal(secondSnapshot.githubRepositories[0].selected, 1);

  const scopedInstallations = await db.prepare("SELECT workspace_id FROM github_workspace_installations WHERE installation_id = ? ORDER BY workspace_id").bind(String(installation.id)).all();
  const scopedRepositories = await db.prepare("SELECT workspace_id FROM github_workspace_repositories WHERE repository_id = ? ORDER BY workspace_id").bind(String(sharedRepository.id)).all();
  assert.deepEqual(scopedInstallations.results.map((row) => row.workspace_id), [first.workspace.id, second.workspace.id].sort());
  assert.deepEqual(scopedRepositories.results.map((row) => row.workspace_id), [first.workspace.id, second.workspace.id].sort());
});

test("legacy GitHub App rows are backfilled without changing the dashboard shape", async () => {
  const { ensureSaasSchema, getSaasSnapshot, provisionCustomerWorkspace } = await import("../db/saas.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  const email = `github.legacy.${crypto.randomUUID()}@example.test`;
  const provisioned = await provisionCustomerWorkspace(email, "Legacy GitHub");
  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);

  const installationId = `legacy-installation-${crypto.randomUUID()}`;
  const repositoryId = `legacy-repository-${crypto.randomUUID()}`;
  await db.batch([
    db.prepare("INSERT INTO github_installations (installation_id, workspace_id, account_login, account_type, repository_selection, permissions_json, connected_by) VALUES (?, ?, 'legacy-org', 'Organization', 'selected', '{}', ?)").bind(installationId, provisioned.workspace.id, email),
    db.prepare("INSERT INTO github_repositories (repository_id, installation_id, workspace_id, full_name, default_branch) VALUES (?, ?, ?, 'legacy-org/service', 'main')").bind(repositoryId, installationId, provisioned.workspace.id),
  ]);

  await ensureSaasSchema();
  const snapshot = await getSaasSnapshot(email);
  assert.deepEqual(snapshot.githubInstallations.map((row) => ({ installation_id: row.installation_id, account_login: row.account_login })), [
    { installation_id: installationId, account_login: "legacy-org" },
  ]);
  assert.deepEqual(snapshot.githubRepositories.map((row) => ({ repository_id: row.repository_id, full_name: row.full_name })), [
    { repository_id: repositoryId, full_name: "legacy-org/service" },
  ]);
});

test("verified repository remapping refreshes an existing project's default branch", async () => {
  const { createProject, provisionCustomerWorkspace } = await import("../db/saas.ts");
  const { refreshVerifiedProjectMapping } = await import("../db/repository-mapping.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  const email = `github.branch.${crypto.randomUUID()}@example.test`;
  const workspace = await provisionCustomerWorkspace(email, "Branch Refresh");
  const project = await createProject(email, {
    name: "Branch Refresh",
    repository: "example/branch-refresh",
    branch: "legacy-default",
  });
  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);

  await refreshVerifiedProjectMapping(db, {
    workspaceId: workspace.workspace.id,
    projectId: project.id,
    defaultBranch: "main",
    graphJson: '{"nodes":[],"edges":[]}',
    scanSummary: "0 components from current default branch",
    serviceCount: 0,
  });

  const refreshed = await db.prepare("SELECT branch, source_kind, repository_verified, status FROM projects WHERE id = ?").bind(project.id).first();
  assert.deepEqual({ ...refreshed }, {
    branch: "main",
    source_kind: "github",
    repository_verified: 1,
    status: "ready",
  });
});

test("runtime schema upgrade preserves subscriptions while adding the Stripe event clock", async () => {
  const { ensureSaasSchema, provisionCustomerWorkspace } = await import("../db/saas.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  const email = `billing.upgrade.${crypto.randomUUID()}@example.test`;
  const workspace = await provisionCustomerWorkspace(email, "Billing Upgrade");
  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);

  await db.prepare("DROP TABLE subscriptions").run();
  await db.prepare("CREATE TABLE subscriptions (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), stripe_customer_id TEXT, stripe_subscription_id TEXT, status TEXT NOT NULL DEFAULT 'trialing', plan TEXT NOT NULL DEFAULT 'trial', current_period_end TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("INSERT INTO subscriptions (workspace_id, stripe_customer_id, stripe_subscription_id, status, plan) VALUES (?, 'cus_legacy', 'sub_legacy', 'active', 'pro')").bind(workspace.workspace.id).run();

  await ensureSaasSchema();
  const columns = await db.prepare("PRAGMA table_info(subscriptions)").all();
  assert.ok(columns.results.some((column) => column.name === "stripe_event_created"));
  assert.ok(columns.results.some((column) => column.name === "stripe_event_priority"));
  const preserved = await db.prepare("SELECT status, plan, stripe_event_created, stripe_event_priority FROM subscriptions WHERE workspace_id = ?").bind(workspace.workspace.id).first();
  assert.deepEqual({ ...preserved }, { status: "active", plan: "pro", stripe_event_created: 0, stripe_event_priority: 0 });
});

test("Stripe checkout completion stores pending and cannot regress an active subscription", async () => {
  const { stripeSubscriptionEventPriority, stripeSubscriptionEventStatus, stripeSubscriptionUpsertSql } = await import("../worldmodel/stripe-subscription.mjs");
  const { provisionCustomerWorkspace } = await import("../db/saas.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  const email = `billing.order.${crypto.randomUUID()}@example.test`;
  const workspace = await provisionCustomerWorkspace(email, "Billing Ordering");
  const workspaceId = workspace.workspace.id;
  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);

  const checkoutStatus = stripeSubscriptionEventStatus("checkout.session.completed", "complete");
  assert.equal(checkoutStatus, "pending");
  assert.equal(stripeSubscriptionEventPriority("checkout.session.completed", checkoutStatus), 0);
  assert.equal(stripeSubscriptionEventPriority("customer.subscription.updated", "active"), 1);
  assert.equal(stripeSubscriptionEventPriority("customer.subscription.deleted", "canceled"), 2);
  assert.equal(stripeSubscriptionEventStatus("customer.subscription.updated", "unknown"), "pending");
  assert.equal(stripeSubscriptionEventStatus("customer.subscription.updated", null), "pending");
  await db.prepare(stripeSubscriptionUpsertSql).bind(workspaceId, "cus_checkout_ordering", "sub_checkout_ordering", checkoutStatus, "starter", null, 0, 0).run();
  assert.equal((await db.prepare("SELECT status FROM subscriptions WHERE workspace_id = ?").bind(workspaceId).first()).status, "pending");

  const periodEnd = new Date(1_900_000_000 * 1000).toISOString();
  await db.prepare(stripeSubscriptionUpsertSql).bind(workspaceId, "cus_checkout_ordering", "sub_checkout_ordering", "active", "pro", periodEnd, 200, 1).run();
  await db.prepare(stripeSubscriptionUpsertSql).bind(workspaceId, "cus_checkout_ordering", "sub_checkout_ordering", checkoutStatus, "starter", null, 0, 0).run();
  const preserved = await db.prepare("SELECT status, plan, current_period_end FROM subscriptions WHERE workspace_id = ?").bind(workspaceId).first();
  assert.deepEqual({ ...preserved }, {
    status: "active",
    plan: "pro",
    current_period_end: periodEnd,
  });
});

test("Stripe lifecycle ordering rejects stale reactivation and gives terminal events tie priority", async () => {
  const { processStripeEvent } = await import("../db/stripe.ts");
  const { provisionCustomerWorkspace } = await import("../db/saas.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  const email = `billing.lifecycle.${crypto.randomUUID()}@example.test`;
  const workspace = await provisionCustomerWorkspace(email, "Billing Lifecycle");
  const workspaceId = workspace.workspace.id;
  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);

  const lifecycle = (type, created, status) => ({
    id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
    type,
    created,
    data: { object: { id: "sub_lifecycle", customer: "cus_lifecycle", status, metadata: { workspace_id: workspaceId, plan: "pro" } } },
  });

  await processStripeEvent(lifecycle("customer.subscription.updated", 300, "active"));
  await processStripeEvent(lifecycle("customer.subscription.deleted", 300, "canceled"));
  const older = await processStripeEvent(lifecycle("customer.subscription.updated", 299, "active"));
  const tied = await processStripeEvent(lifecycle("customer.subscription.updated", 300, "active"));
  assert.equal(older.stale, true);
  assert.equal(tied.stale, true);

  const canceled = await db.prepare("SELECT status, plan, stripe_event_created, stripe_event_priority FROM subscriptions WHERE workspace_id = ?").bind(workspaceId).first();
  assert.deepEqual({ ...canceled }, { status: "canceled", plan: "pro", stripe_event_created: 300, stripe_event_priority: 2 });
  assert.deepEqual({ ...(await db.prepare("SELECT plan, monthly_limit FROM workspaces WHERE id = ?").bind(workspaceId).first()) }, { plan: "free", monthly_limit: 50 });

  await processStripeEvent(lifecycle("customer.subscription.resumed", 301, "active"));
  assert.deepEqual({ ...(await db.prepare("SELECT status, stripe_event_created, stripe_event_priority FROM subscriptions WHERE workspace_id = ?").bind(workspaceId).first()) }, { status: "active", stripe_event_created: 301, stripe_event_priority: 1 });
  assert.deepEqual({ ...(await db.prepare("SELECT plan, monthly_limit FROM workspaces WHERE id = ?").bind(workspaceId).first()) }, { plan: "pro", monthly_limit: 500 });
});

test("modeled planning runs cannot be promoted or reported as verified evidence", async () => {
  const {
    createProject,
    createSimulationRunForWorkspace,
    getSimulationReport,
    provisionCustomerWorkspace,
    verifySimulationRunForWorkspace,
  } = await import("../db/saas.ts");
  const { getRuntimeEnv } = await import("../server/runtime-env.ts");
  const email = `evidence.${crypto.randomUUID()}@example.test`;
  const provisioned = await provisionCustomerWorkspace(email, "Evidence Integrity");
  const project = await createProject(email, {
    name: "Planning Only",
    repository: "example/planning-only",
    branch: "main",
  });

  const run = await createSimulationRunForWorkspace(
    provisioned.workspace.id,
    `api-key:test-${crypto.randomUUID()}`,
    "traffic",
    project.id,
  );
  assert.equal(run.status, "modeled");
  assert.equal(run.evidence_kind, "modeled");
  assert.equal(run.after_score, null);
  await assert.rejects(
    () => verifySimulationRunForWorkspace(provisioned.workspace.id, email, run.id),
    /Modeled planning runs cannot become verified evidence/,
  );
  await assert.rejects(
    () => getSimulationReport(email, run.id),
    /signed observed runner evidence/,
  );

  const db = (await getRuntimeEnv()).DB;
  assert.ok(db);
  await db.prepare("UPDATE simulation_runs SET status = 'verified' WHERE id = ?").bind(run.id).run();
  await assert.rejects(
    () => getSimulationReport(email, run.id),
    /signed observed runner evidence/,
  );
  const audit = await db.prepare("SELECT action FROM audit_logs WHERE workspace_id = ? AND target_id = ?").bind(provisioned.workspace.id, run.id).first();
  assert.deepEqual({ ...audit }, { action: "simulation.modeled" });
});

test("runner OIDC exchange returns only the approved immutable execution descriptor", async () => {
  const fixture = await runnerFixture();
  const { exchangeRunnerOidc } = await import("../server/github-oidc.ts");
  const { immutableScenario } = await import("../worldmodel/runner-evidence.ts");
  const audience = "https://worldmodel.example/api/v1/runner/token";
  const workflowSha = "b".repeat(40);
  const now = Math.floor(Date.now() / 1000);
  const oidcClaims = {
    iss: "https://token.actions.githubusercontent.com",
    aud: audience,
    exp: now + 300,
    nbf: now - 5,
    repository: fixture.repository,
    ref: "refs/heads/main",
    workflow_ref: `${fixture.repository}/.github/workflows/worldmodel-${fixture.projectId}.yml@refs/heads/main`,
    workflow_sha: workflowSha,
    event_name: "workflow_dispatch",
  };
  const signed = await signGithubOidc(oidcClaims);
  const originalFetch = globalThis.fetch;
  let keys = [signed.jwk];
  let fetches = 0;
  let workflowVerifications = 0;
  let observedAbortSignal = false;
  const verifyWorkflow = async (verification) => {
    workflowVerifications += 1;
    assert.equal(verification.db, fixture.db);
    assert.deepEqual({
      workspaceId: verification.workspaceId,
      projectId: verification.projectId,
      repository: verification.repository,
      workflowSha: verification.workflowSha,
      apiOrigin: verification.apiOrigin,
    }, {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      repository: fixture.repository,
      workflowSha,
      apiOrigin: "https://worldmodel.example",
    });
    return true;
  };
  globalThis.fetch = async (_url, init) => {
    fetches += 1;
    observedAbortSignal ||= init?.signal instanceof AbortSignal;
    return Response.json({ keys });
  };
  try {
    await fixture.db.prepare("UPDATE environment_revisions SET status = 'draft' WHERE id = ?").bind(fixture.environmentId).run();
    await assert.rejects(
      () => exchangeRunnerOidc({ oidcToken: signed.token, audience, projectId: fixture.projectId, runId: fixture.runId }, verifyWorkflow),
      /not bound to an approved GitHub Actions environment/,
    );
    assert.equal(workflowVerifications, 0);
    await fixture.db.prepare("UPDATE environment_revisions SET status = 'approved' WHERE id = ?").bind(fixture.environmentId).run();
    const result = await exchangeRunnerOidc({ oidcToken: signed.token, audience, projectId: fixture.projectId, runId: fixture.runId }, verifyWorkflow);
    const immutable = await immutableScenario(fixture.scenario);
    assert.match(result.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.deepEqual(result.execution, {
      projectId: fixture.projectId,
      runId: fixture.runId,
      repository: { fullName: fixture.repository, branch: "main" },
      scenario: immutable.scenario,
      scenarioFingerprint: immutable.fingerprint,
      environment: { id: fixture.environmentId, backend: "github_actions", manifest: fixture.manifest },
      model: { id: fixture.modelId, commitSha: "a".repeat(40) },
    });
    assert.equal(fetches, 1, "the second exchange should use the bounded JWKS cache");
    assert.equal(observedAbortSignal, true);

    const rotated = await signGithubOidc(oidcClaims);
    keys = [rotated.jwk];
    await exchangeRunnerOidc({ oidcToken: rotated.token, audience, projectId: fixture.projectId, runId: fixture.runId }, verifyWorkflow);
    assert.equal(fetches, 2, "an unknown key id should force exactly one JWKS refresh");
    assert.equal(workflowVerifications, 1, "a successful workflow revision verification should be cached for five minutes");

    const mismatched = await signGithubOidc({ ...oidcClaims, workflow_sha: "c".repeat(40) });
    keys = [mismatched.jwk];
    await assert.rejects(
      () => exchangeRunnerOidc({ oidcToken: mismatched.token, audience, projectId: fixture.projectId, runId: fixture.runId }, async () => false),
      /signed GitHub workflow revision does not match/,
    );

    const unavailable = await signGithubOidc({ ...oidcClaims, workflow_sha: "d".repeat(40) });
    keys = [unavailable.jwk];
    await assert.rejects(
      () => exchangeRunnerOidc({ oidcToken: unavailable.token, audience, projectId: fixture.projectId, runId: fixture.runId }, async () => { throw new Error("provider offline"); }),
      /runner_verification_unavailable:/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("signed runner evidence persists one verified observed run and is replay-safe", async () => {
  const fixture = await runnerFixture();
  const { acceptRunnerEvidence } = await import("../server/github-oidc.ts");
  const evidence = await observedEvidence(fixture);
  const token = await signRunnerToken(fixture);

  const first = await acceptRunnerEvidence(token, JSON.stringify(evidence));
  assert.equal(first.accepted, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.status, "completed");
  assert.match(first.simulationRunId, /^run_observed_[a-f0-9]{32}$/);

  const simulation = await fixture.db.prepare(`
    SELECT status, evidence_kind, scenario_key, scenario_fingerprint, seed,
           before_score, after_score, before_error_rate, after_error_rate,
           before_latency_ms, after_latency_ms, before_journey_success, after_journey_success,
           before_service_health, after_service_health, error_rate, latency_ms, journey_success,
           duration_seconds, environment_id, journey_runner, environment_destroyed_at, attestation_json
    FROM simulation_runs WHERE id = ?
  `).bind(first.simulationRunId).first();
  assert.deepEqual({ ...simulation }, {
    status: "verified",
    evidence_kind: "observed",
    scenario_key: null,
    scenario_fingerprint: evidence.scenarioFingerprint,
    seed: evidence.seed,
    before_score: 42,
    after_score: 91,
    before_error_rate: "12.5%",
    after_error_rate: "1.2%",
    before_latency_ms: 3200,
    after_latency_ms: 640,
    before_journey_success: 60,
    after_journey_success: 99,
    before_service_health: 55,
    after_service_health: 96,
    error_rate: "1.2%",
    latency_ms: 640,
    journey_success: 99,
    duration_seconds: 19,
    environment_id: evidence.environment.id,
    journey_runner: "playwright",
    environment_destroyed_at: evidence.environment.destroyedAt,
    attestation_json: JSON.stringify(evidence),
  });
  const campaignRun = await fixture.db.prepare("SELECT status, simulation_run_id FROM campaign_runs WHERE id = ?").bind(fixture.runId).first();
  const campaign = await fixture.db.prepare("SELECT status FROM campaigns WHERE id = ?").bind(fixture.campaignId).first();
  assert.deepEqual({ ...campaignRun }, { status: "completed", simulation_run_id: first.simulationRunId });
  assert.deepEqual({ ...campaign }, { status: "completed" });
  const events = await fixture.db.prepare("SELECT sequence, type, source, journey_id, evidence_ref FROM run_events WHERE run_id = ? ORDER BY sequence").bind(fixture.runId).all();
  assert.deepEqual(events.results.map((row) => ({ ...row })), [
    { sequence: 1, type: "verification.completed", source: "github_actions", journey_id: fixture.journeyId, evidence_ref: first.simulationRunId },
    { sequence: 2, type: "run.completed", source: "github_actions", journey_id: fixture.journeyId, evidence_ref: first.simulationRunId },
  ]);

  const replay = await acceptRunnerEvidence(token, JSON.stringify(evidence));
  assert.deepEqual(replay, { ...first, duplicate: true });
  const counts = await Promise.all([
    fixture.db.prepare("SELECT COUNT(*) AS count FROM simulation_runs WHERE project_id = ? AND evidence_kind = 'observed'").bind(fixture.projectId).first(),
    fixture.db.prepare("SELECT COUNT(*) AS count FROM runner_callbacks WHERE run_id = ?").bind(fixture.runId).first(),
    fixture.db.prepare("SELECT COUNT(*) AS count FROM run_events WHERE run_id = ?").bind(fixture.runId).first(),
  ]);
  assert.deepEqual(counts.map((row) => row.count), [1, 1, 2]);
});

test("runner evidence rejects missing, unbounded, or false teardown claims without persistence", async () => {
  const fixture = await runnerFixture();
  const { acceptRunnerEvidence } = await import("../server/github-oidc.ts");
  const evidence = await observedEvidence(fixture);
  const token = await signRunnerToken(fixture);
  await assert.rejects(
    () => acceptRunnerEvidence(token, JSON.stringify({ ...evidence, after: { ...evidence.after, latencyMs: 120_001 } })),
    /after\.latencyMs must be between 1 and 120000/,
  );
  await assert.rejects(
    () => acceptRunnerEvidence(token, JSON.stringify({ ...evidence, environment: { ...evidence.environment, destroyedAt: evidence.journey.startedAt } })),
    /Environment teardown must follow Playwright completion/,
  );
  const oldStart = Date.now() - 24 * 60 * 60_000;
  await assert.rejects(
    () => acceptRunnerEvidence(token, JSON.stringify({
      ...evidence,
      environment: { ...evidence.environment, destroyedAt: new Date(oldStart + 20_000).toISOString() },
      journey: { ...evidence.journey, startedAt: new Date(oldStart).toISOString(), endedAt: new Date(oldStart + 19_000).toISOString() },
    })),
    /predates the authorized campaign run/,
  );
  const run = await fixture.db.prepare("SELECT status, simulation_run_id FROM campaign_runs WHERE id = ?").bind(fixture.runId).first();
  const callback = await fixture.db.prepare("SELECT COUNT(*) AS count FROM runner_callbacks WHERE run_id = ?").bind(fixture.runId).first();
  const simulations = await fixture.db.prepare("SELECT COUNT(*) AS count FROM simulation_runs WHERE project_id = ? AND evidence_kind = 'observed'").bind(fixture.projectId).first();
  assert.deepEqual({ ...run }, { status: "queued", simulation_run_id: null });
  assert.equal(callback.count, 0);
  assert.equal(simulations.count, 0);
});

test("valid evidence after cancellation links the observation but terminates as cancelled", async () => {
  const fixture = await runnerFixture({ runStatus: "cancellation_requested", campaignStatus: "cancellation_requested" });
  const { acceptRunnerEvidence } = await import("../server/github-oidc.ts");
  const evidence = await observedEvidence(fixture);
  const token = await signRunnerToken(fixture);
  const result = await acceptRunnerEvidence(token, JSON.stringify(evidence));
  assert.equal(result.status, "cancelled");
  const run = await fixture.db.prepare("SELECT status, simulation_run_id FROM campaign_runs WHERE id = ?").bind(fixture.runId).first();
  const campaign = await fixture.db.prepare("SELECT status FROM campaigns WHERE id = ?").bind(fixture.campaignId).first();
  const simulation = await fixture.db.prepare("SELECT status, evidence_kind FROM simulation_runs WHERE id = ?").bind(result.simulationRunId).first();
  const terminal = await fixture.db.prepare("SELECT type FROM run_events WHERE run_id = ? ORDER BY sequence DESC LIMIT 1").bind(fixture.runId).first();
  assert.deepEqual({ ...run }, { status: "cancelled", simulation_run_id: result.simulationRunId });
  assert.deepEqual({ ...campaign }, { status: "cancelled" });
  assert.deepEqual({ ...simulation }, { status: "verified", evidence_kind: "observed" });
  assert.deepEqual({ ...terminal }, { type: "run.cancelled" });
});
