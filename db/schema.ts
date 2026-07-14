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
