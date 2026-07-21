import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

process.env.WORLDMODEL_LOCAL_RUNTIME = "true";
process.env.WORLDMODEL_LOCAL_STATE_DIR = path.join(
  tmpdir(),
  `worldmodel-workspace-onboarding-${process.pid}-${crypto.randomUUID()}`,
);

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
