import { sql } from "drizzle-orm";
import { foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  plan: text("plan").notNull().default("trial"),
  simulationMinutes: integer("simulation_minutes").notNull().default(0),
  monthlyLimit: integer("monthly_limit").notNull().default(500),
  workspaceMode: text("workspace_mode").notNull().default("customer"),
  trialEndsAt: text("trial_ends_at"),
  usagePeriodStart: text("usage_period_start"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  repository: text("repository").notNull(),
  branch: text("branch").notNull().default("main"),
  sourceKind: text("source_kind").notNull().default("manual"),
  repositoryVerified: integer("repository_verified", { mode: "boolean" }).notNull().default(false),
  graphJson: text("graph_json").notNull().default('{"version":1,"nodes":[],"edges":[]}'),
  scanSummary: text("scan_summary"),
  scannedAt: text("scanned_at"),
  status: text("status").notNull().default("ready"),
  resilienceScore: integer("resilience_score").notNull().default(0),
  serviceCount: integer("service_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const simulationRuns = sqliteTable("simulation_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  scenario: text("scenario").notNull(),
  status: text("status").notNull(),
  beforeScore: integer("before_score").notNull(),
  afterScore: integer("after_score"),
  errorRate: text("error_rate").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  journeySuccess: integer("journey_success").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  scenarioKey: text("scenario_key"),
  scenarioFingerprint: text("scenario_fingerprint"),
  seed: text("seed"),
  beforeErrorRate: text("before_error_rate"),
  afterErrorRate: text("after_error_rate"),
  beforeLatencyMs: integer("before_latency_ms"),
  afterLatencyMs: integer("after_latency_ms"),
  beforeJourneySuccess: integer("before_journey_success"),
  afterJourneySuccess: integer("after_journey_success"),
  verifiedAt: text("verified_at"),
  evidenceKind: text("evidence_kind").notNull().default("modeled"),
  environmentId: text("environment_id"),
  journeyRunner: text("journey_runner"),
  environmentDestroyedAt: text("environment_destroyed_at"),
  beforeServiceHealth: integer("before_service_health"),
  afterServiceHealth: integer("after_service_health"),
  attestationJson: text("attestation_json"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("simulation_runs_replay_identity_idx").on(
    table.projectId,
    table.scenarioFingerprint,
    table.seed,
    table.evidenceKind,
  ),
]);

export const repairProposals = sqliteTable("repair_proposals", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  runId: text("run_id").notNull().references(() => simulationRuns.id),
  status: text("status").notNull().default("ready_for_review"),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  filesJson: text("files_json").notNull().default("[]"),
  testsJson: text("tests_json").notNull().default("[]"),
  risksJson: text("risks_json").notNull().default("[]"),
  createdBy: text("created_by").notNull(),
  reviewerEmail: text("reviewer_email"),
  decisionNote: text("decision_note"),
  requestedAt: text("requested_at"),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  prStatus: text("pr_status").notNull().default("not_requested"),
  branchName: text("branch_name"),
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
  prError: text("pr_error"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("repair_proposals_run_idx").on(table.runId),
]);

export const workspaceMembers = sqliteTable("workspace_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("workspace_members_workspace_email_idx").on(table.workspaceId, table.email),
]);

export const workspaceInvitations = sqliteTable("workspace_invitations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  tokenHash: text("token_hash").notNull(),
  status: text("status").notNull().default("pending"),
  invitedBy: text("invited_by").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  acceptedAt: text("accepted_at"),
  revokedAt: text("revoked_at"),
}, (table) => [
  uniqueIndex("workspace_invitations_token_hash_idx").on(table.tokenHash),
]);

export const invitationRateBuckets = sqliteTable("invitation_rate_buckets", {
  id: text("id").primaryKey(),
  subjectHash: text("subject_hash").notNull(),
  bucketStart: text("bucket_start").notNull(),
  requestCount: integer("request_count").notNull().default(0),
}, (table) => [
  uniqueIndex("invitation_rate_subject_start_idx").on(table.subjectHash, table.bucketStart),
]);

export const userPreferences = sqliteTable("user_preferences", {
  email: text("email").primaryKey(),
  activeWorkspaceId: text("active_workspace_id").notNull().references(() => workspaces.id),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const integrationStates = sqliteTable("integration_states", {
  token: text("token").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  purpose: text("purpose").notNull(),
  installationId: text("installation_id"),
  createdBy: text("created_by").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
});

export const githubInstallations = sqliteTable("github_installations", {
  installationId: text("installation_id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  accountLogin: text("account_login").notNull(),
  accountType: text("account_type").notNull(),
  repositorySelection: text("repository_selection").notNull(),
  permissionsJson: text("permissions_json").notNull(),
  status: text("status").notNull().default("active"),
  connectedBy: text("connected_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const githubRepositories = sqliteTable("github_repositories", {
  repositoryId: text("repository_id").primaryKey(),
  installationId: text("installation_id").notNull().references(() => githubInstallations.installationId),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  fullName: text("full_name").notNull(),
  defaultBranch: text("default_branch").notNull(),
  isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(true),
  selected: integer("selected", { mode: "boolean" }).notNull().default(false),
  syncedAt: text("synced_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Tenant-scoped replacements for the legacy GitHub App tables above. GitHub
// installation and repository IDs are global identifiers, so neither is a
// safe tenant boundary by itself. Keeping workspaceId in the primary and
// foreign keys lets the same GitHub organization be connected to more than
// one WorldModel workspace without either workspace moving the other's rows.
export const githubWorkspaceInstallations = sqliteTable("github_workspace_installations", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  installationId: text("installation_id").notNull(),
  accountLogin: text("account_login").notNull(),
  accountType: text("account_type").notNull(),
  repositorySelection: text("repository_selection").notNull(),
  permissionsJson: text("permissions_json").notNull(),
  status: text("status").notNull().default("active"),
  connectedBy: text("connected_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.installationId] }),
  index("github_workspace_installations_workspace_idx").on(table.workspaceId, table.status),
]);

export const githubWorkspaceRepositories = sqliteTable("github_workspace_repositories", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  repositoryId: text("repository_id").notNull(),
  installationId: text("installation_id").notNull(),
  fullName: text("full_name").notNull(),
  defaultBranch: text("default_branch").notNull(),
  isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(true),
  selected: integer("selected", { mode: "boolean" }).notNull().default(false),
  syncedAt: text("synced_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.repositoryId] }),
  foreignKey({
    columns: [table.workspaceId, table.installationId],
    foreignColumns: [githubWorkspaceInstallations.workspaceId, githubWorkspaceInstallations.installationId],
  }),
  index("github_workspace_repositories_workspace_idx").on(table.workspaceId, table.selected, table.fullName),
]);

export const composioConnectionAttempts = sqliteTable("composio_connection_attempts", {
  stateHash: text("state_hash").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  createdBy: text("created_by").notNull(),
  composioUserId: text("composio_user_id").notNull(),
  connectedAccountId: text("connected_account_id"),
  authConfigId: text("auth_config_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const composioConnections = sqliteTable("composio_connections", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  connectedAccountId: text("connected_account_id").notNull(),
  composioUserId: text("composio_user_id").notNull(),
  authConfigId: text("auth_config_id").notNull(),
  toolkitSlug: text("toolkit_slug").notNull().default("github"),
  providerLogin: text("provider_login").notNull(),
  status: text("status").notNull().default("active"),
  connectedBy: text("connected_by").notNull(),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("composio_connections_workspace_account_idx").on(table.workspaceId, table.connectedAccountId),
]);

export const composioGithubRepositories = sqliteTable("composio_github_repositories", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull().references(() => composioConnections.id),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  repositoryId: text("repository_id").notNull(),
  fullName: text("full_name").notNull(),
  defaultBranch: text("default_branch").notNull(),
  isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(true),
  htmlUrl: text("html_url").notNull(),
  selected: integer("selected", { mode: "boolean" }).notNull().default(false),
  syncedAt: text("synced_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("composio_repositories_connection_repo_idx").on(table.connectionId, table.repositoryId),
]);

export const subscriptions = sqliteTable("subscriptions", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  status: text("status").notNull().default("trialing"),
  plan: text("plan").notNull().default("trial"),
  currentPeriodEnd: text("current_period_end"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const billingEvents = sqliteTable("billing_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: text("processed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  summary: text("summary").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const supportCases = sqliteTable("support_cases", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  createdBy: text("created_by").notNull(),
  subject: text("subject").notNull(),
  category: text("category").notNull(),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("open"),
  body: text("body").notNull(),
  operatorNote: text("operator_note"),
  assignedTo: text("assigned_to"),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dataDeletionRequests = sqliteTable("data_deletion_requests", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  requestedBy: text("requested_by").notNull(),
  scope: text("scope").notNull().default("workspace"),
  status: text("status").notNull().default("pending"),
  reason: text("reason"),
  executeAfter: text("execute_after").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  canceledAt: text("canceled_at"),
  completedAt: text("completed_at"),
});

export const launchChecks = sqliteTable("launch_checks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  checkKey: text("check_key").notNull(),
  passed: integer("passed", { mode: "boolean" }).notNull().default(false),
  evidence: text("evidence"),
  attestedBy: text("attested_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("launch_checks_workspace_key_idx").on(table.workspaceId, table.checkKey),
]);

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  scopesJson: text("scopes_json").notNull(),
  status: text("status").notNull().default("active"),
  createdBy: text("created_by").notNull(),
  lastUsedAt: text("last_used_at"),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  revokedAt: text("revoked_at"),
}, (table) => [
  uniqueIndex("api_keys_hash_idx").on(table.keyHash),
]);

export const apiRateBuckets = sqliteTable("api_rate_buckets", {
  id: text("id").primaryKey(),
  apiKeyId: text("api_key_id").notNull().references(() => apiKeys.id),
  bucketStart: text("bucket_start").notNull(),
  requestCount: integer("request_count").notNull().default(0),
}, (table) => [
  uniqueIndex("api_rate_buckets_key_start_idx").on(table.apiKeyId, table.bucketStart),
]);
