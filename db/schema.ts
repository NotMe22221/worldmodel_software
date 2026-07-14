import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  plan: text("plan").notNull().default("trial"),
  simulationMinutes: integer("simulation_minutes").notNull().default(0),
  monthlyLimit: integer("monthly_limit").notNull().default(500),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  repository: text("repository").notNull(),
  branch: text("branch").notNull().default("main"),
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
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workspaceMembers = sqliteTable("workspace_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("workspace_members_workspace_email_idx").on(table.workspaceId, table.email),
]);

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
