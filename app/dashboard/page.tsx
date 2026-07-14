"use client";

import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import "./dashboard.css";
import "./observed.css";

type Tab =
  | "overview"
  | "projects"
  | "runs"
  | "reports"
  | "repairs"
  | "integrations"
  | "api"
  | "readiness"
  | "audit"
  | "usage"
  | "team"
  | "support"
  | "settings";
type Workspace = {
  id: string;
  name: string;
  plan: string;
  simulation_minutes: number;
  monthly_limit: number;
  membership_role: string;
  trial_ends_at: string;
  usage_period_start: string;
  workspace_mode: "sample" | "customer";
};
type Project = {
  id: string;
  name: string;
  repository: string;
  branch: string;
  source_kind: "sample" | "manual" | "github";
  repository_verified: number;
  graph_json: string;
  scan_summary: string | null;
  scanned_at: string | null;
  status: string;
  resilience_score: number;
  service_count: number;
  updated_at: string;
};
type Run = {
  id: string;
  project_name: string;
  scenario: string;
  status: string;
  before_score: number;
  after_score: number | null;
  error_rate: string;
  latency_ms: number;
  journey_success: number;
  source_kind: "sample" | "manual" | "github";
  repository_verified: number;
  evidence_kind: "sample_fixture" | "modeled" | "observed";
  created_at: string;
};
type Repair = {
  id: string;
  run_id: string;
  status: string;
  title: string;
  summary: string;
  files_json: string;
  tests_json: string;
  risks_json: string;
  created_by: string;
  reviewer_email: string | null;
  decision_note: string | null;
  requested_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  pr_status: string;
  branch_name: string | null;
  pr_url: string | null;
  pr_number: number | null;
  pr_error: string | null;
  published_at: string | null;
  updated_at: string;
  scenario: string;
  scenario_fingerprint: string;
  before_score: number;
  after_score: number;
  verified_at: string;
  project_name: string;
  repository: string;
  project_branch: string;
  source_kind: "sample" | "manual" | "github";
  repository_verified: number;
  evidence_kind: "sample_fixture" | "modeled" | "observed";
};
type Member = { email: string; role: string; created_at: string };
type AvailableWorkspace = { id: string; name: string; role: string; workspace_mode: "sample" | "customer" };
type WorkspaceInvitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  invited_by: string;
  expires_at: string;
  created_at: string;
};
type GithubInstallation = {
  installation_id: string;
  account_login: string;
  account_type: string;
  repository_selection: string;
  status: string;
  connected_at: string;
};
type GithubRepository = {
  repository_id: string;
  full_name: string;
  default_branch: string;
  is_private: number;
  selected: number;
  synced_at: string;
};
type Subscription = {
  status: string;
  plan: string;
  current_period_end: string | null;
  updated_at: string;
  portal_available: number;
} | null;
type AuditLog = {
  id: string;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string;
  created_at: string;
};
type SupportCase = {
  id: string;
  created_by: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
};
type LaunchCheck = {
  key: string;
  label: string;
  category: string;
  passed: boolean;
  source: "automatic" | "attested";
  evidence: string;
};
type Readiness = {
  checks: LaunchCheck[];
  passed: number;
  total: number;
  score: number;
  ready: boolean;
};
type Activation = {
  completed: number;
  total: number;
  percent: number;
  steps: Array<{
    key: "repository" | "simulation" | "verification" | "team";
    label: string;
    complete: boolean;
    completedAt: string | null;
  }>;
};
type DeletionRequest = {
  id: string;
  scope: string;
  status: string;
  reason: string | null;
  execute_after: string;
  created_at: string;
  canceled_at: string | null;
  completed_at: string | null;
};
type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  scopes_json: string;
  status: string;
  created_by: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
};
type Entitlements = {
  planKey: string;
  planName: string;
  lifecycle: string;
  billingStatus: string | null;
  access: string;
  canWrite: boolean;
  message: string;
  limits: {
    simulationMinutes: number;
    projects: number;
    seats: number;
    apiKeys: number;
  };
  trialEndsAt: string | null;
  trialDaysRemaining: number;
  usagePeriodStart: string;
  usagePeriodEnd: string;
};
type Snapshot = {
  workspace: Workspace;
  availableWorkspaces: AvailableWorkspace[];
  projects: Project[];
  runs: Run[];
  repairs: Repair[];
  members: Member[];
  pendingInvitations: WorkspaceInvitation[];
  githubInstallations: GithubInstallation[];
  githubRepositories: GithubRepository[];
  subscription: Subscription;
  entitlements: Entitlements;
  activation: Activation | null;
  auditAccess: boolean;
  auditLogs: AuditLog[];
  supportCases: SupportCase[];
  deletionRequests: DeletionRequest[];
  apiKeys: ApiKey[];
  apiUsage: { requests_today: number };
  readiness: Readiness;
  configuration: {
    github: { configured: boolean; appSlug: string | null };
    billing: { configured: boolean; portalConfigured: boolean };
  };
  user: { email: string; displayName: string };
  operatorAccess: boolean;
};

const navItems: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "projects", label: "Projects", icon: "◇" },
  { id: "runs", label: "Simulation runs", icon: "▶" },
  { id: "reports", label: "Reports", icon: "▤" },
  { id: "repairs", label: "Repair reviews", icon: "✦" },
  { id: "integrations", label: "Integrations", icon: "⌘" },
  { id: "api", label: "Developer API", icon: "{ }" },
  { id: "readiness", label: "Launch readiness", icon: "✓" },
  { id: "audit", label: "Audit log", icon: "◉" },
  { id: "usage", label: "Usage & plan", icon: "◒" },
  { id: "team", label: "Team", icon: "♙" },
  { id: "support", label: "Support", icon: "?" },
  { id: "settings", label: "Settings", icon: "⚙" },
];
function Logo() {
  return (
    <span className="saas-logo" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
function statusLabel(status: string) {
  return status === "verified"
    ? "Verified"
    : status === "completed"
      ? "Needs repair"
      : status === "scanning"
        ? "Scanning"
        : status === "unverified"
          ? "Unverified"
        : "Ready";
}
function mappedNodes(project: Project) {
  try {
    const graph = JSON.parse(project.graph_json || "{}");
    return Array.isArray(graph.nodes)
      ? graph.nodes.filter(
          (node: unknown) =>
            Boolean(node) && typeof (node as { name?: unknown }).name === "string",
        ) as Array<{ id: string; name: string; kind: string; confidence: string; evidence: string[] }>
      : [];
  } catch {
    return [];
  }
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Just now"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function stringList(value: string) {
  try {
    const result = JSON.parse(value);
    return Array.isArray(result) ? result.map(String) : [];
  } catch {
    return [];
  }
}
function repairStatus(value: string) {
  return value.replaceAll("_", " ");
}

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [newApiToken, setNewApiToken] = useState("");
  const [newInviteLink, setNewInviteLink] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/saas");
    const payload = await response.json();
    if (!response.ok)
      throw new Error(payload.error || "Unable to load workspace");
    setData(payload);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/saas", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || "Unable to load workspace");
        return payload;
      })
      .then(setData)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        setError(
          reason instanceof Error ? reason.message : "Unable to load workspace",
        );
      });
    return () => controller.abort();
  }, []);
  async function mutate(payload: Record<string, FormDataEntryValue | null>) {
    const response = await fetch("/api/saas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to save changes");
    await load();
    return result;
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await mutate({
        action: "create-project",
        name: form.get("name"),
        repository: form.get("repository"),
        branch: form.get("branch"),
      });
      setShowCreate(false);
      setTab("projects");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to create project",
      );
    } finally {
      setCreating(false);
    }
  }
  async function teamMutate(payload: Record<string, string>) {
    const response = await fetch("/api/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Unable to update the team");
    await load();
    return result;
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await teamMutate({
        action: "invite",
        email: String(form.get("email") || ""),
        role: String(form.get("role") || "member"),
      });
      setNewInviteLink(
        `${location.origin}/invite?token=${encodeURIComponent(result.token)}`,
      );
      setNotice("Invitation created and its seat is reserved.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to create invitation",
      );
    } finally {
      setCreating(false);
    }
  }
  async function switchActiveWorkspace(workspaceId: string) {
    if (workspaceId === data?.workspace.id) return;
    setCreating(true);
    setError("");
    try {
      await mutate({ action: "switch-workspace", workspaceId });
      setTab("overview");
      setNotice("Active workspace changed.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to switch workspace",
      );
    } finally {
      setCreating(false);
    }
  }
  async function provisionRealWorkspace() {
    setCreating(true);
    setError("");
    try {
      const result = await mutate({ action: "provision-customer-workspace" });
      setTab("projects");
      setNotice(result.created ? "Clean customer workspace created. Connect your first repository." : "Switched to your existing customer workspace.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create customer workspace");
    } finally {
      setCreating(false);
    }
  }
  async function revokeInvitation(invitationId: string) {
    setCreating(true);
    setError("");
    try {
      await teamMutate({ action: "revoke-invitation", invitationId });
      setNotice("Invitation revoked; the seat is available again.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to revoke invitation",
      );
    } finally {
      setCreating(false);
    }
  }
  async function updateMemberRole(email: string, role: string) {
    setCreating(true);
    setError("");
    try {
      await teamMutate({ action: "update-role", email, role });
      setNotice(`${email} is now a ${role}.`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to update role",
      );
    } finally {
      setCreating(false);
    }
  }
  async function removeMember(email: string) {
    if (!confirm(`Remove ${email} from this workspace?`)) return;
    setCreating(true);
    setError("");
    try {
      await teamMutate({ action: "remove-member", email });
      setNotice(`${email} was removed from the workspace.`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to remove member",
      );
    } finally {
      setCreating(false);
    }
  }
  async function repairAction(
    action: string,
    proposalId: string,
    note?: string,
  ) {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/repairs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, proposalId, note }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to update repair review");
      await load();
      const messages: Record<string, string> = {
        "request-review": "Repair submitted for an administrator review.",
        approve: "Repair approved with review evidence.",
        "request-changes": "Changes requested; the repair must be resubmitted.",
        "prepare-pr": "Draft pull request handoff prepared.",
        "publish-pr": "GitHub draft pull request published.",
      };
      setNotice(messages[action] || "Repair workflow updated.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update repair review",
      );
    } finally {
      setCreating(false);
    }
  }
  async function saveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await mutate({ action: "update-workspace", name: form.get("name") });
      setNotice("Workspace settings saved.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to save workspace",
      );
    } finally {
      setCreating(false);
    }
  }
  async function importRepository(repositoryId: string) {
    setCreating(true);
    setError("");
    try {
      await mutate({ action: "import-repository", repositoryId });
      setNotice(
        "Repository imported. WorldModel is preparing its software twin.",
      );
      setTab("projects");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to import repository",
      );
    } finally {
      setCreating(false);
    }
  }
  async function checkout(plan: "starter" | "pro") {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to start checkout");
      location.href = result.url;
    } catch (reason) {
      setShowUpgrade(false);
      setNotice(
        reason instanceof Error ? reason.message : "Unable to start checkout",
      );
    } finally {
      setCreating(false);
    }
  }
  async function openBillingPortal() {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to open billing management");
      location.href = result.url;
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Unable to open billing management",
      );
    } finally {
      setCreating(false);
    }
  }
  async function createSupport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: form.get("subject"),
          category: form.get("category"),
          priority: form.get("priority"),
          body: form.get("body"),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to create support case");
      await load();
      event.currentTarget.reset();
      setNotice(`Support case ${result.supportCase.id} opened.`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to create support case",
      );
    } finally {
      setCreating(false);
    }
  }
  async function updateReadiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/readiness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: form.get("key"),
          passed: form.get("passed") === "true",
          evidence: form.get("evidence"),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to update launch check");
      await load();
      setNotice("Launch readiness evidence updated.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update launch check",
      );
    } finally {
      setCreating(false);
    }
  }
  async function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/data/deletion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request", reason: form.get("reason") }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to request deletion review");
      await load();
      setNotice(
        "Workspace deletion review requested. You can cancel it during the seven-day review window.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to request deletion review",
      );
    } finally {
      setCreating(false);
    }
  }
  async function cancelDeletion(requestId: string) {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/data/deletion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel", requestId }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to cancel deletion review");
      await load();
      setNotice("Workspace deletion review canceled.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to cancel deletion review",
      );
    } finally {
      setCreating(false);
    }
  }
  async function createApiCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const expiration = String(form.get("expirationDays") || "");
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: form.get("name"),
          scopes: form.getAll("scopes"),
          expirationDays: expiration === "never" ? null : Number(expiration),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to create API key");
      setNewApiToken(result.token);
      await load();
      event.currentTarget.reset();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to create API key",
      );
    } finally {
      setCreating(false);
    }
  }
  async function revokeApiCredential(keyId: string) {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke", keyId }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to revoke API key");
      await load();
      setNotice("API key revoked immediately.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to revoke API key",
      );
    } finally {
      setCreating(false);
    }
  }
  if (!data && !error)
    return (
      <main className="saas-loading">
        <Logo />
        <div />
        <span>Loading your workspace…</span>
      </main>
    );
  if (!data)
    return (
      <main className="saas-loading">
        <Logo />
        <h1>Workspace unavailable</h1>
        <p>{error}</p>
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    );
  const verifiedRuns = data.runs.filter(
    (run) => run.status === "verified",
  ).length;
  const observedRuns = data.runs.filter(
    (run) => run.status === "verified" && run.evidence_kind === "observed",
  ).length;
  const usagePercent = Math.min(
    100,
    Math.round(
      (data.workspace.simulation_minutes /
        data.entitlements.limits.simulationMinutes) *
        100,
    ),
  );
  const activeApiKeys = data.apiKeys.filter(
    (key) => key.status === "active",
  ).length;
  const canCreateProject =
    data.entitlements.canWrite &&
    data.workspace.workspace_mode === "customer" &&
    data.projects.length < data.entitlements.limits.projects;
  const occupiedSeats = data.members.length + data.pendingInvitations.length;
  const canInvite =
    data.entitlements.canWrite &&
    occupiedSeats < data.entitlements.limits.seats &&
    (data.workspace.membership_role === "owner" ||
      data.workspace.membership_role === "admin");
  const canManageBilling =
    Boolean(data.subscription?.portal_available) &&
    data.configuration.billing.portalConfigured &&
    (data.workspace.membership_role === "owner" ||
      data.workspace.membership_role === "admin");
  const lifecycleLabel =
    data.entitlements.lifecycle === "trial"
      ? `PRO TRIAL · ${data.entitlements.trialDaysRemaining} DAYS LEFT`
      : data.entitlements.lifecycle === "past_due"
        ? "PAYMENT ATTENTION"
        : `${data.entitlements.planName.toUpperCase()} · ${data.entitlements.lifecycle.replaceAll("_", " ").toUpperCase()}`;
  return (
    <main className="saas-shell">
      <aside className="saas-sidebar">
        <div className="saas-brand">
          <Logo />
          <span>WorldModel</span>
          <b>{data.entitlements.planName.toUpperCase()}</b>
        </div>
        <label className="workspace-switcher">
          <span>{data.workspace.name.slice(0, 2).toUpperCase()}</span>
          <div>
            <b>{data.workspace.name}</b>
            <small>
              {data.workspace.workspace_mode === "sample"
                ? "Sample"
                : data.entitlements.planName} · {data.workspace.membership_role}
            </small>
          </div>
          <select
            aria-label="Active workspace"
            value={data.workspace.id}
            disabled={creating}
            onChange={(event) => switchActiveWorkspace(event.target.value)}
          >
            {data.availableWorkspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}{workspace.workspace_mode === "sample" ? " (sample)" : ""} · {workspace.role}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="Workspace navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              data-testid={`nav-${item.id}`}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              <i>{item.icon}</i>
              {item.label}
              {item.id === "reports" && <em>{verifiedRuns}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="trial-card">
            <span>{lifecycleLabel}</span>
            <b>
              {data.workspace.simulation_minutes} of{" "}
              {data.entitlements.limits.simulationMinutes} minutes
            </b>
            <div>
              <i style={{ width: `${usagePercent}%` }} />
            </div>
            <small>{data.entitlements.message}</small>
            <button onClick={() => setShowUpgrade(true)}>View plans</button>
          </div>
          <button
            className="user-chip"
            onClick={
              data.operatorAccess
                ? () => (location.href = "/operator")
                : undefined
            }
            title={data.operatorAccess ? "Open operator console" : undefined}
          >
            <span>{data.user.displayName.slice(0, 2).toUpperCase()}</span>
            <div>
              <b>{data.user.displayName}</b>
              <small>{data.user.email}</small>
            </div>
            <em>•••</em>
          </button>
        </div>
      </aside>
      <section className="saas-main">
        <header className="saas-topbar">
          <div>
            <span>{data.workspace.name}</span>
            <b>/</b>
            <strong>{navItems.find((item) => item.id === tab)?.label}</strong>
          </div>
          <div>
            <button className="icon-button" aria-label="Help">
              ?
            </button>
            <button className="icon-button" aria-label="Notifications">
              ♢<i />
            </button>
            <button
              className="new-project"
              data-testid="new-project"
              disabled={creating || (data.workspace.workspace_mode === "customer" && !canCreateProject)}
              onClick={data.workspace.workspace_mode === "sample" ? provisionRealWorkspace : () => setTab("integrations")}
            >
              {data.workspace.workspace_mode === "sample" ? "＋ Clean workspace" : "＋ Import repository"}
            </button>
          </div>
        </header>
        <div className="saas-content">
          {notice && (
            <button className="saas-notice" onClick={() => setNotice("")}>
              ✓ {notice}
              <span>×</span>
            </button>
          )}
          {!data.entitlements.canWrite && (
            <div className="entitlement-banner">
              <b>Write actions are paused.</b>
              <span>{data.entitlements.message}</span>
              <button onClick={() => setShowUpgrade(true)}>
                Review billing
              </button>
            </div>
          )}
          {data.workspace.workspace_mode === "sample" && (
            <div className="sample-workspace-banner">
              <div>
                <b>Prepared sample workspace</b>
                <span>
                  Northstar repositories, runs, repairs, metrics, and reports are illustrative—not customer evidence.
                </span>
              </div>
              <button disabled={creating} onClick={provisionRealWorkspace}>
                {creating ? "Creating…" : "Create clean workspace →"}
              </button>
            </div>
          )}
          {tab === "overview" && (
            <>
              <section className="welcome-row">
                <div>
                  <span>MONDAY, JULY 13</span>
                  <h1>Good evening, {data.user.displayName}.</h1>
                  <p>
                    {data.workspace.workspace_mode === "sample"
                      ? "Explore the prepared Northstar example, then create a clean workspace for real repository evidence."
                      : "Your software twins ran three resilience experiments this week. One verified repair is ready for review."}
                  </p>
                </div>
                <button onClick={() => (location.href = "/")}>
                  Run a simulation <b>→</b>
                </button>
              </section>
              <section className="saas-kpis">
                <Kpi
                  label="AVERAGE RESILIENCE"
                  value="82"
                  suffix="/100"
                  note="↑ 12 this month"
                />
                <Kpi
                  label="SIMULATION RUNS"
                  value={String(data.runs.length)}
                  note="Persisted evidence"
                />
                <Kpi
                  label="OBSERVED REPAIRS"
                  value={String(observedRuns)}
                  note={`${verifiedRuns - observedRuns} modeled replays`}
                />
                <Kpi
                  label="AUDIT EVENTS"
                  value={String(data.auditLogs.length)}
                  note="Immutable trail"
                />
              </section>
              <div className="overview-grid">
                <ProjectList
                  projects={data.projects}
                  onAll={() => setTab("projects")}
                />
                <Activity events={data.auditLogs.slice(0, 3)} />
              </div>
              <div className="overview-grid bottom">
                <section className="saas-card">
                  <CardHeader
                    eyebrow="RECENT RUNS"
                    title="Simulation history"
                    action="View all →"
                    onAction={() => setTab("runs")}
                  />
                  <RunTable runs={data.runs.slice(0, 3)} />
                </section>
                {data.activation ? (
                  <section className="saas-card activation-card">
                    <header>
                      <div>
                        <span>GET STARTED</span>
                        <b>Workspace activation</b>
                      </div>
                      <strong>{data.activation.percent}%</strong>
                    </header>
                    <div className="activation-progress">
                      <i style={{ width: `${data.activation.percent}%` }} />
                    </div>
                    <ol>
                      {data.activation.steps.map((step) => (
                        <li className={step.complete ? "complete" : ""} key={step.key}>
                          <i>{step.complete ? "✓" : data.activation!.steps.indexOf(step) + 1}</i>
                          <span>
                            <b>{step.label}</b>
                            <small>{step.complete ? `Completed${step.completedAt ? ` · ${dateLabel(step.completedAt)}` : ""}` : "Required for an activated workspace"}</small>
                          </span>
                          {!step.complete && (
                            <button onClick={() => {
                              if (step.key === "repository") setTab("integrations");
                              if (step.key === "simulation" || step.key === "verification") location.href = "/";
                              if (step.key === "team") setTab("team");
                            }}>Start →</button>
                          )}
                        </li>
                      ))}
                    </ol>
                    <p>{data.activation.completed} of {data.activation.total} activation milestones complete.</p>
                  </section>
                ) : (
                <section className="saas-card readiness-card">
                  <span>LAUNCH READINESS</span>
                  <div
                    className="readiness-score"
                    style={
                      {
                        "--readiness": `${data.readiness.score * 3.6}deg`,
                      } as CSSProperties
                    }
                  >
                    <strong>{data.readiness.score}</strong>
                    <small>/100</small>
                  </div>
                  <h3>
                    {data.readiness.ready
                      ? "Go-live gate passed"
                      : "Launch blockers remain"}
                  </h3>
                  <p>
                    {data.readiness.passed} of {data.readiness.total}{" "}
                    evidence-backed checks are complete.
                  </p>
                  <button onClick={() => setTab("readiness")}>
                    Review launch gate →
                  </button>
                </section>
                )}
              </div>
            </>
          )}
          {tab === "projects" && (
            <>
              <SectionHeader
                eyebrow="PROJECTS"
                title="Software twins"
                description={data.workspace.workspace_mode === "sample" ? "This prepared repository is isolated from customer work. Create a clean workspace before connecting a real repository." : `${data.projects.length} of ${data.entitlements.limits.projects === 1000 ? "unlimited" : data.entitlements.limits.projects} projects used on ${data.entitlements.planName}.`}
                action={data.workspace.workspace_mode === "sample" ? "Create clean workspace" : canCreateProject ? "Import from GitHub" : undefined}
                onAction={data.workspace.workspace_mode === "sample" ? provisionRealWorkspace : () => setTab("integrations")}
              />
              <section className="project-grid">
                {data.projects.map((project) => (
                  <article key={project.id}>
                    <div className="project-card-top">
                      <div className="project-icon">◇</div>
                      <span className={`saas-status ${project.status}`}>
                        {statusLabel(project.status)}
                      </span>
                    </div>
                    <h3>{project.name}</h3>
                    <p>⌘ {project.repository}</p>
                    <span className={`repository-proof ${project.repository_verified ? "verified" : "unverified"}`}>
                      {project.source_kind === "sample" ? "SAMPLE REPOSITORY" : project.repository_verified ? "GITHUB OWNERSHIP VERIFIED" : "OWNERSHIP UNVERIFIED"}
                    </span>
                    <dl>
                      <div>
                        <dt>Resilience</dt>
                        <dd>{project.resilience_score || "—"}</dd>
                      </div>
                      <div>
                        <dt>Services</dt>
                        <dd>{project.service_count || (project.status === "unverified" ? "Not mapped" : "Scanning")}</dd>
                      </div>
                      <div>
                        <dt>Branch</dt>
                        <dd>{project.branch}</dd>
                      </div>
                    </dl>
                    {project.source_kind === "sample" ? (
                      <button onClick={() => (location.href = "/")}>Open prepared software twin →</button>
                    ) : mappedNodes(project).length ? (
                      <details className="project-map-preview">
                        <summary>View mapped system · {mappedNodes(project).length} components</summary>
                        <small>{project.scan_summary}</small>
                        <ul>
                          {mappedNodes(project).map((node) => (
                            <li key={node.id}>
                              <span><b>{node.name}</b><small>{node.kind} · {node.confidence}</small></span>
                              <em>{node.evidence?.[0] || "Repository tree"}</em>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <button onClick={() => setTab("integrations")}>Import through GitHub to map →</button>
                    )}
                    {Boolean(project.repository_verified) && (
                      <button className="runner-workflow" onClick={() => (location.href = `/api/runner/workflow?project=${encodeURIComponent(project.id)}`)}>
                        Download CI runner workflow ↓
                      </button>
                    )}
                  </article>
                ))}
                <button
                  className="add-project-card"
                  disabled={creating || (data.workspace.workspace_mode === "customer" && !canCreateProject)}
                  onClick={data.workspace.workspace_mode === "sample" ? provisionRealWorkspace : () => setShowCreate(true)}
                >
                  ＋
                  <b>
                    {data.workspace.workspace_mode === "sample"
                      ? "Create a clean customer workspace"
                      : canCreateProject
                      ? "Add an unverified manual project"
                      : "Project limit reached"}
                  </b>
                  <small>
                    {data.workspace.workspace_mode === "sample"
                      ? "Sample evidence never mixes with real repositories"
                      : canCreateProject
                      ? "For pilot planning only; GitHub import is recommended"
                      : "Upgrade to add another software twin"}
                  </small>
                </button>
              </section>
            </>
          )}
          {tab === "runs" && (
            <>
              <SectionHeader
                eyebrow="SIMULATIONS"
                title="Run history"
                description="Every run preserves its scenario, seed, environment, telemetry, and journey evidence."
                action="New simulation"
                onAction={() => (location.href = "/")}
              />
              <section className="saas-card full-table">
                <RunTable runs={data.runs} />
                {!data.runs.length && (
                  <div className="saas-empty-state">
                    <b>No simulations yet</b>
                    <p>Connect a repository, map its system graph, and run a repeatable failure scenario.</p>
                  </div>
                )}
              </section>
            </>
          )}
          {tab === "reports" && (
            <>
              <SectionHeader
                eyebrow="REPORTS"
                title="Verification evidence"
                description="Decision-ready before-and-after proof for reviewers, pull requests, and release gates."
              />
              <section className="report-grid-saas">
                {data.runs
                  .filter((run) => run.status === "verified")
                  .map((run) => (
                    <article key={run.id}>
                      <span>{data.workspace.workspace_mode === "sample" ? "SAMPLE VERIFIED REPORT" : run.evidence_kind === "observed" ? "OBSERVED VERIFIED REPORT" : "MODELED REPLAY REPORT"}</span>
                      <h3>{run.scenario}</h3>
                      <p>
                        {run.project_name} · {dateLabel(run.created_at)}
                      </p>
                      <div>
                        <strong>{run.before_score}</strong>
                        <em>→</em>
                        <strong>{run.after_score}</strong>
                        <b>+{(run.after_score || 0) - run.before_score}</b>
                      </div>
                      <ul>
                        <li>{run.evidence_kind === "modeled" ? "~ Deterministic replay modeled" : "✓ Immutable replay matched"}</li>
                        <li>✓ Journey success {run.journey_success}%</li>
                        <li>✓ {data.workspace.workspace_mode === "sample" ? "Illustrative sample evidence" : run.repository_verified ? "GitHub ownership validated" : "Repository ownership unverified"}</li>
                      </ul>
                      <button
                        onClick={() =>
                          (location.href = `/api/reports?run=${encodeURIComponent(run.id)}`)
                        }
                      >
                        Download report ↓
                      </button>
                    </article>
                  ))}
                {!data.runs.some((run) => run.status === "verified") && (
                  <div className="saas-empty-state report-empty">
                    <b>No verification reports yet</b>
                    <p>Verified before-and-after reports appear after an identical scenario replay passes.</p>
                  </div>
                )}
              </section>
            </>
          )}
          {tab === "repairs" && (
            <>
              <SectionHeader
                eyebrow="HUMAN REVIEW"
                title="Repair approval queue"
                description="Codex candidates remain untrusted until a workspace reviewer evaluates the verified replay, residual risks, and exact handoff evidence."
              />
              <section className="repair-queue">
                {data.repairs.map((repair) => (
                  <article
                    className="saas-card repair-review-card"
                    key={repair.id}
                  >
                    <header>
                      <div>
                        <span>
                          {repair.project_name} · {repair.scenario} · {repair.evidence_kind === "observed" ? "OBSERVED" : repair.evidence_kind === "sample_fixture" ? "SAMPLE" : "MODELED"}
                        </span>
                        <b>{repair.title}</b>
                      </div>
                      <em className={`repair-state ${repair.status}`}>
                        {repairStatus(repair.status)}
                      </em>
                    </header>
                    <div className="repair-body">
                      <p>{repair.summary}</p>
                      <div className="repair-score">
                        <span>VERIFIED REPLAY</span>
                        <strong>{repair.before_score}</strong>
                        <em>→</em>
                        <strong>{repair.after_score}</strong>
                        <code>{repair.scenario_fingerprint}</code>
                      </div>
                      <div className="repair-evidence">
                        <section>
                          <b>FILES</b>
                          {stringList(repair.files_json).map((item) => (
                            <code key={item}>{item}</code>
                          ))}
                        </section>
                        <section>
                          <b>CHECKS</b>
                          {stringList(repair.tests_json).map((item) => (
                            <span key={item}>✓ {item}</span>
                          ))}
                        </section>
                        <section>
                          <b>RESIDUAL RISKS</b>
                          {stringList(repair.risks_json).map((item) => (
                            <span key={item}>! {item}</span>
                          ))}
                        </section>
                      </div>
                      {repair.decision_note && (
                        <blockquote>
                          <b>Review evidence</b>
                          <p>{repair.decision_note}</p>
                          <small>
                            {repair.approved_by ||
                              repair.reviewer_email ||
                              "Workspace reviewer"}{" "}
                            ·{" "}
                            {dateLabel(repair.approved_at || repair.updated_at)}
                          </small>
                        </blockquote>
                      )}
                      {repair.status === "pr_ready" && (
                        <div className="pr-handoff">
                          <b>
                            {repair.pr_status === "published"
                              ? `Draft pull request #${repair.pr_number} published`
                              : repair.pr_status === "ready_to_publish"
                                ? "GitHub publication ready"
                                : repair.pr_status === "permission_required"
                                  ? "GitHub permissions required"
                                  : repair.pr_status === "publication_failed"
                                    ? "GitHub publication failed"
                                    : "GitHub connection required"}
                          </b>
                          <code>{repair.branch_name}</code>
                          <p>
                            {repair.pr_status === "published"
                              ? "GitHub confirmed the draft pull request and WorldModel recorded its URL and audit evidence."
                              : repair.pr_status === "ready_to_publish"
                                ? "The installation grants Contents and Pull requests write access. Publication will create a branch, commit the approved evidence packet, and open a draft."
                                : repair.pr_status === "permission_required"
                                  ? "Update the GitHub App installation to grant Contents and Pull requests write access."
                                  : repair.pr_status === "publication_failed"
                                    ? repair.pr_error ||
                                      "GitHub rejected the publication attempt. Retry after resolving repository access."
                                    : "Connect and import this repository before publishing. No pull request has been falsely claimed."}
                          </p>
                          {repair.pr_url && (
                            <a
                              href={repair.pr_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open draft pull request ↗
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    <footer>
                      <button
                        onClick={() =>
                          (location.href = `/api/repairs?proposal=${encodeURIComponent(repair.id)}`)
                        }
                      >
                        Download evidence ↓
                      </button>
                      {(repair.status === "ready_for_review" ||
                        repair.status === "changes_requested") &&
                        data.workspace.membership_role !== "viewer" && (
                          <button
                            className="primary"
                            disabled={creating}
                            onClick={() =>
                              repairAction("request-review", repair.id)
                            }
                          >
                            Submit for review →
                          </button>
                        )}
                      {repair.status === "in_review" &&
                        (data.workspace.membership_role === "owner" ||
                          data.workspace.membership_role === "admin") && (
                          <>
                            <button
                              disabled={creating}
                              onClick={() => {
                                const note = prompt(
                                  "Describe the required change (10–1000 characters)",
                                );
                                if (note)
                                  repairAction(
                                    "request-changes",
                                    repair.id,
                                    note,
                                  );
                              }}
                            >
                              Request changes
                            </button>
                            <button
                              className="primary"
                              disabled={creating}
                              onClick={() => {
                                const note = prompt(
                                  "Record approval evidence (10–1000 characters)",
                                );
                                if (note)
                                  repairAction("approve", repair.id, note);
                              }}
                            >
                              Approve repair ✓
                            </button>
                          </>
                        )}
                      {repair.status === "approved" &&
                        (data.workspace.membership_role === "owner" ||
                          data.workspace.membership_role === "admin") && (
                          <button
                            className="primary"
                            disabled={creating}
                            onClick={() =>
                              repairAction("prepare-pr", repair.id)
                            }
                          >
                            Prepare draft PR →
                          </button>
                        )}
                      {repair.status === "pr_ready" &&
                        (repair.pr_status === "ready_to_publish" ||
                          repair.pr_status === "publication_failed") &&
                        (data.workspace.membership_role === "owner" ||
                          data.workspace.membership_role === "admin") && (
                          <button
                            className="primary"
                            disabled={creating}
                            onClick={() =>
                              repairAction("publish-pr", repair.id)
                            }
                          >
                            {creating
                              ? "Publishing…"
                              : repair.pr_status === "publication_failed"
                                ? "Retry publication →"
                                : "Publish draft PR →"}
                          </button>
                        )}
                    </footer>
                  </article>
                ))}
                {!data.repairs.length && (
                  <section className="saas-card access-empty">
                    <b>No verified repair candidates</b>
                    <p>
                      Verify an identical scenario replay to create a reviewable
                      repair proposal.
                    </p>
                  </section>
                )}
              </section>
            </>
          )}
          {tab === "integrations" && (
            <>
              <SectionHeader
                eyebrow="INTEGRATIONS"
                title="Connected systems"
                description="Install least-privilege providers once, then import repositories and publish verified work from the workspace."
              />
              <section className="integration-grid">
                <article className="saas-card integration-card">
                  <header>
                    <i>⌘</i>
                    <div>
                      <h3>GitHub App</h3>
                      <p>
                        Repository metadata, contents, checks, and draft pull
                        requests.
                      </p>
                    </div>
                    <span
                      className={
                        data.githubInstallations.length
                          ? "connected"
                          : "available"
                      }
                    >
                      {data.githubInstallations.length
                        ? "Connected"
                        : data.configuration.github.configured
                          ? "Ready"
                          : "Setup required"}
                    </span>
                  </header>
                  {data.githubInstallations.length ? (
                    <>
                      <div className="integration-account">
                        <b>{data.githubInstallations[0].account_login}</b>
                        <small>
                          {data.githubInstallations[0].account_type} ·{" "}
                          {data.githubRepositories.length} repositories
                          synchronized
                        </small>
                      </div>
                      <div className="repository-picker">
                        {data.githubRepositories
                          .slice(0, 6)
                          .map((repository) => (
                            <div key={repository.repository_id}>
                              <span>
                                <b>{repository.full_name}</b>
                                <small>
                                  {repository.default_branch} ·{" "}
                                  {repository.is_private ? "private" : "public"}
                                </small>
                              </span>
                              {repository.selected ? (
                                <button
                                  disabled={creating}
                                  onClick={() => importRepository(repository.repository_id)}
                                >
                                  {data.projects.some((project) => project.repository.toLowerCase() === repository.full_name.toLowerCase() && project.scanned_at) ? "Refresh map" : "Map repository"}
                                </button>
                              ) : (
                                <button
                                  disabled={creating}
                                  onClick={() =>
                                    importRepository(repository.repository_id)
                                  }
                                >
                                  Create twin
                                </button>
                              )}
                            </div>
                          ))}
                      </div>
                      <button
                        className="secondary-integration"
                        onClick={() =>
                          (location.href = "/api/integrations/github/start")
                        }
                      >
                        Manage installation ↗
                      </button>
                    </>
                  ) : (
                    <>
                      <ul>
                        <li>✓ OAuth user ownership validation</li>
                        <li>✓ Installation-scoped repository tokens</li>
                        <li>✓ Explicit Contents + Pull requests write gate</li>
                        <li>✓ No long-lived GitHub token stored</li>
                      </ul>
                      <button
                        disabled={!data.configuration.github.configured}
                        onClick={() =>
                          (location.href = "/api/integrations/github/start")
                        }
                      >
                        {data.configuration.github.configured
                          ? "Install GitHub App →"
                          : "Awaiting app credentials"}
                      </button>
                    </>
                  )}
                </article>
                <article className="saas-card integration-card">
                  <header>
                    <i>＄</i>
                    <div>
                      <h3>Stripe Billing</h3>
                      <p>
                        Hosted checkout, subscription entitlements, and signed
                        webhooks.
                      </p>
                    </div>
                    <span
                      className={data.subscription ? "connected" : "available"}
                    >
                      {data.subscription
                        ? data.subscription.status
                        : data.configuration.billing.configured
                          ? "Ready"
                          : "Setup required"}
                    </span>
                  </header>
                  <div className="integration-account">
                    <b>
                      {data.subscription
                        ? `${data.subscription.plan} plan`
                        : data.entitlements.planName}
                    </b>
                    <small>
                      {data.subscription?.current_period_end
                        ? `Current period ends ${dateLabel(data.subscription.current_period_end)}`
                        : data.entitlements.message}
                    </small>
                  </div>
                  <ul>
                    <li>✓ Stripe-hosted payment collection</li>
                    <li>✓ Idempotent webhook processing</li>
                    <li>✓ Server-enforced plan limits</li>
                  </ul>
                  <button
                    disabled={!data.configuration.billing.configured}
                    onClick={() => setShowUpgrade(true)}
                  >
                    {data.configuration.billing.configured
                      ? "Manage plan →"
                      : "Awaiting Stripe credentials"}
                  </button>
                </article>
              </section>
            </>
          )}
          {tab === "api" && (
            <>
              <SectionHeader
                eyebrow="AUTOMATION"
                title="Developer API"
                description={`${activeApiKeys} of ${data.entitlements.limits.apiKeys} API keys active on ${data.entitlements.planName}.`}
              />
              <section className="api-layout">
                {data.auditAccess ? (
                  <>
                    <form
                      className="saas-card api-create"
                      onSubmit={createApiCredential}
                    >
                      <span>NEW CREDENTIAL</span>
                      <h3>Create an API key</h3>
                      <p>
                        The complete secret appears once. Store it in your CI
                        secret manager, never in source control.
                      </p>
                      <label>
                        Key name
                        <input
                          name="name"
                          required
                          maxLength={80}
                          placeholder="Production CI"
                          disabled={data.entitlements.limits.apiKeys === 0}
                        />
                      </label>
                      <fieldset
                        disabled={data.entitlements.limits.apiKeys === 0}
                      >
                        <legend>Scopes</legend>
                        <label>
                          <input
                            type="checkbox"
                            name="scopes"
                            value="projects:read"
                            defaultChecked
                          />{" "}
                          projects:read
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            name="scopes"
                            value="runs:read"
                            defaultChecked
                          />{" "}
                          runs:read
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            name="scopes"
                            value="runs:write"
                          />{" "}
                          runs:write
                        </label>
                      </fieldset>
                      <label>
                        Expiration
                        <select
                          name="expirationDays"
                          defaultValue="90"
                          disabled={data.entitlements.limits.apiKeys === 0}
                        >
                          <option value="30">30 days</option>
                          <option value="90">90 days</option>
                          <option value="365">1 year</option>
                          <option value="never">No expiry</option>
                        </select>
                      </label>
                      {error && <p className="form-error">{error}</p>}
                      <button
                        disabled={
                          creating ||
                          !data.entitlements.canWrite ||
                          activeApiKeys >= data.entitlements.limits.apiKeys
                        }
                      >
                        {creating
                          ? "Creating…"
                          : data.entitlements.limits.apiKeys === 0
                            ? "Upgrade for API access"
                            : activeApiKeys >= data.entitlements.limits.apiKeys
                              ? "Key limit reached"
                              : "Create API key"}
                      </button>
                    </form>
                    <section className="api-main">
                      {newApiToken && (
                        <article className="api-secret">
                          <header>
                            <div>
                              <span>COPY THIS SECRET NOW</span>
                              <b>It will not be shown again.</b>
                            </div>
                            <button
                              onClick={() => setNewApiToken("")}
                              aria-label="Dismiss API secret"
                            >
                              ×
                            </button>
                          </header>
                          <code>{newApiToken}</code>
                          <button
                            onClick={() =>
                              navigator.clipboard.writeText(newApiToken)
                            }
                          >
                            Copy secret
                          </button>
                        </article>
                      )}
                      <article className="saas-card api-docs">
                        <header>
                          <div>
                            <span>QUICK START</span>
                            <b>Trigger a repeatable scenario</b>
                          </div>
                          <em>60 requests/minute</em>
                        </header>
                        <pre>
                          <code>{`curl -X POST ${typeof location !== "undefined" ? location.origin : "https://your-worldmodel-host"}/api/v1/runs \\\n  -H "Authorization: Bearer $WORLDMODEL_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"projectId":"${data.projects[0]?.id || "proj_id"}","scenario":"database"}'`}</code>
                        </pre>
                        <p>
                          POST again with{" "}
                          <code>{`{"action":"verify","runId":"run_id"}`}</code>{" "}
                          to replay the identical scenario after repair.
                        </p>
                        <details className="api-observed">
                          <summary>Submit observed Playwright evidence →</summary>
                          <p>
                            CI runners can submit bounded before/after telemetry only after the disposable environment is destroyed. The run is labeled observed and retains its environment attestation.
                          </p>
                          <pre><code>{`{
  "action": "observe",
  "projectId": "${data.projects[0]?.id || "proj_id"}",
  "scenario": "database",
  "fingerprint": "scn_database_800ms_v1",
  "seed": "ci_run_20260714_001",
  "environment": { "id": "wm-ci-8421", "destroyedAt": "2026-07-14T03:30:00Z" },
  "journey": { "runner": "playwright", "name": "checkout", "startedAt": "2026-07-14T03:27:00Z", "endedAt": "2026-07-14T03:29:00Z" },
  "before": { "resilienceScore": 38, "errorRate": 21.4, "latencyMs": 3190, "journeySuccess": 54, "serviceHealth": 57 },
  "after": { "resilienceScore": 88, "errorRate": 1.2, "latencyMs": 734, "journeySuccess": 98, "serviceHealth": 96 }
}`}</code></pre>
                        </details>
                      </article>
                      <article className="saas-card api-keys">
                        <header>
                          <div>
                            <span>API KEYS</span>
                            <b>
                              {activeApiKeys} active ·{" "}
                              {Number(data.apiUsage.requests_today || 0)}{" "}
                              requests today
                            </b>
                          </div>
                        </header>
                        {data.apiKeys.map((key) => (
                          <div key={key.id}>
                            <span>
                              <b>{key.name}</b>
                              <code>{key.key_prefix}</code>
                              <small>
                                {JSON.parse(key.scopes_json).join(" · ")}
                              </small>
                            </span>
                            <span>
                              <b className={`key-status ${key.status}`}>
                                {key.status}
                              </b>
                              <small>
                                {key.last_used_at
                                  ? `Used ${dateLabel(key.last_used_at)}`
                                  : "Never used"}
                              </small>
                            </span>
                            {key.status === "active" ? (
                              <button
                                disabled={creating}
                                onClick={() => revokeApiCredential(key.id)}
                              >
                                Revoke
                              </button>
                            ) : (
                              <em>Revoked</em>
                            )}
                          </div>
                        ))}
                        {!data.apiKeys.length && (
                          <p>
                            No API keys yet. Create one for a CI or internal
                            automation workflow.
                          </p>
                        )}
                      </article>
                      <article className="api-boundary">
                        <b>Private pilot boundary</b>
                        <p>
                          Key authentication, scopes, tenant isolation, and rate
                          limiting are active. External CI traffic still
                          requires an API-capable production ingress because
                          this Sites deployment remains private.
                        </p>
                      </article>
                    </section>
                  </>
                ) : (
                  <section className="saas-card access-empty">
                    <b>Developer API management is restricted</b>
                    <p>
                      Workspace owners and administrators can create or revoke
                      automation credentials.
                    </p>
                  </section>
                )}
              </section>
            </>
          )}
          {tab === "readiness" && (
            <>
              <SectionHeader
                eyebrow="GO-LIVE CONTROL"
                title="Launch readiness"
                description="Automatic product evidence and explicit owner attestations form one honest commercial launch gate."
              />
              <section className="readiness-layout">
                <article className="saas-card readiness-summary">
                  <span>WORKSPACE SCORE</span>
                  <div
                    className="readiness-score large"
                    style={
                      {
                        "--readiness": `${data.readiness.score * 3.6}deg`,
                      } as CSSProperties
                    }
                  >
                    <strong>{data.readiness.score}</strong>
                    <small>/100</small>
                  </div>
                  <h3>
                    {data.readiness.ready
                      ? "Ready for commercial launch"
                      : "Not ready for commercial launch"}
                  </h3>
                  <p>
                    {data.readiness.passed} of {data.readiness.total} checks
                    complete. Automatic checks can only pass from live product
                    state.
                  </p>
                </article>
                <section className="readiness-list">
                  {data.readiness.checks.map((check) => (
                    <article
                      className={`saas-card readiness-item ${check.passed ? "passed" : "blocked"}`}
                      key={check.key}
                    >
                      <span className="check-state">
                        {check.passed ? "✓" : "!"}
                      </span>
                      <div>
                        <header>
                          <b>{check.label}</b>
                          <span>
                            {check.category} · {check.source}
                          </span>
                        </header>
                        <p>{check.evidence}</p>
                        {check.source === "attested" &&
                          data.workspace.membership_role === "owner" &&
                          (check.passed ? (
                            <form onSubmit={updateReadiness}>
                              <input
                                type="hidden"
                                name="key"
                                value={check.key}
                              />
                              <input
                                type="hidden"
                                name="passed"
                                value="false"
                              />
                              <input
                                type="hidden"
                                name="evidence"
                                value="Reopened by workspace owner"
                              />
                              <button disabled={creating}>Reopen check</button>
                            </form>
                          ) : (
                            <form onSubmit={updateReadiness}>
                              <input
                                type="hidden"
                                name="key"
                                value={check.key}
                              />
                              <input type="hidden" name="passed" value="true" />
                              <input
                                name="evidence"
                                required
                                maxLength={500}
                                placeholder="Link, owner, date, or review record"
                              />
                              <button disabled={creating}>
                                Attest complete
                              </button>
                            </form>
                          ))}
                      </div>
                    </article>
                  ))}
                </section>
              </section>
            </>
          )}
          {tab === "audit" && (
            <>
              <SectionHeader
                eyebrow="GOVERNANCE"
                title="Workspace audit log"
                description="An append-only record of material changes, simulations, integrations, billing events, and support activity."
                action={
                  data.auditAccess ? "Export CSV" : "Admin access required"
                }
                onAction={
                  data.auditAccess
                    ? () => (location.href = "/api/audit/export")
                    : undefined
                }
              />
              {data.auditAccess ? (
                <section className="saas-card audit-table">
                  <header>
                    <span>EVENT</span>
                    <span>ACTOR</span>
                    <span>TARGET</span>
                    <span>TIME</span>
                  </header>
                  {data.auditLogs.map((event) => (
                    <div key={event.id}>
                      <span>
                        <b>{event.summary}</b>
                        <small>
                          {event.action} · {event.id}
                        </small>
                      </span>
                      <span>{event.actor_email}</span>
                      <span>{event.target_type}</span>
                      <span>{dateLabel(event.created_at)}</span>
                    </div>
                  ))}
                  {!data.auditLogs.length && (
                    <p>No material workspace events have been recorded yet.</p>
                  )}
                </section>
              ) : (
                <section className="saas-card access-empty">
                  <b>Audit access is restricted</b>
                  <p>
                    Workspace owners and administrators can review or export the
                    organization-wide trail.
                  </p>
                </section>
              )}
            </>
          )}
          {tab === "usage" && (
            <>
              <SectionHeader
                eyebrow="USAGE & PLAN"
                title={`${data.entitlements.planName} plan`}
                description={data.entitlements.message}
                action={canManageBilling ? "Manage billing" : "View plans"}
                onAction={
                  canManageBilling
                    ? openBillingPortal
                    : () => setShowUpgrade(true)
                }
              />
              <section className="billing-grid">
                <article className="saas-card usage-detail">
                  <span>
                    SIMULATION MINUTES ·{" "}
                    {new Date(data.entitlements.usagePeriodStart)
                      .toLocaleDateString("en-US", { month: "long" })
                      .toUpperCase()}
                  </span>
                  <div>
                    <strong>{data.workspace.simulation_minutes}</strong>
                    <small>
                      {" "}
                      / {data.entitlements.limits.simulationMinutes} minutes
                    </small>
                  </div>
                  <div className="usage-bar">
                    <i style={{ width: `${usagePercent}%` }} />
                  </div>
                  <p>
                    {Math.max(
                      0,
                      data.entitlements.limits.simulationMinutes -
                        data.workspace.simulation_minutes,
                    )}{" "}
                    minutes remaining · resets{" "}
                    {dateLabel(data.entitlements.usagePeriodEnd)}
                  </p>
                  <div className="usage-bars">
                    {[18, 32, 24, 46, 62, 38, 74, 58, 81, 66, 42, 54].map(
                      (height, index) => (
                        <i key={index} style={{ height: `${height}%` }} />
                      ),
                    )}
                  </div>
                </article>
                <article className="saas-card plan-card">
                  <span>CURRENT PLAN</span>
                  <h3>{data.entitlements.planName}</h3>
                  <strong>
                    {data.entitlements.lifecycle.replaceAll("_", " ")}
                    <small>
                      {data.entitlements.billingStatus
                        ? ` · ${data.entitlements.billingStatus}`
                        : ""}
                    </small>
                  </strong>
                  <ul>
                    <li>
                      ✓ {data.entitlements.limits.simulationMinutes} simulation
                      minutes
                    </li>
                    <li>
                      ✓{" "}
                      {data.entitlements.limits.projects === 1000
                        ? "Unlimited"
                        : data.entitlements.limits.projects}{" "}
                      projects
                    </li>
                    <li>
                      ✓ {data.entitlements.limits.seats} team seat
                      {data.entitlements.limits.seats === 1 ? "" : "s"}
                    </li>
                    <li>
                      ✓ {data.entitlements.limits.apiKeys} API key
                      {data.entitlements.limits.apiKeys === 1 ? "" : "s"}
                    </li>
                    <li>✓ Verified reports and repair evidence</li>
                  </ul>
                  <button
                    onClick={
                      canManageBilling
                        ? openBillingPortal
                        : () => setShowUpgrade(true)
                    }
                    disabled={creating}
                  >
                    {canManageBilling
                      ? "Manage subscription & invoices ↗"
                      : "Review plan options"}
                  </button>
                </article>
              </section>
            </>
          )}
          {tab === "team" && (
            <>
              <SectionHeader
                eyebrow="TEAM"
                title="Workspace members"
                description={`${occupiedSeats} of ${data.entitlements.limits.seats} seats reserved on ${data.entitlements.planName}; ${data.pendingInvitations.length} pending.`}
                action={canInvite ? "Invite member" : undefined}
                onAction={() => setShowInvite(true)}
              />
              <section className="saas-card members-table">
                <header>
                  <span>MEMBER</span>
                  <span>ROLE</span>
                  <span>JOINED</span>
                  <span></span>
                </header>
                {data.members.map((member) => {
                  const canManage =
                    member.role !== "owner" &&
                    (data.workspace.membership_role === "owner" ||
                      (data.workspace.membership_role === "admin" &&
                        member.role !== "admin"));
                  return (
                    <div key={member.email}>
                      <span className="member-name">
                        <i>{member.email.slice(0, 2).toUpperCase()}</i>
                        <b>{member.email}</b>
                      </span>
                      {canManage ? (
                        <select
                          className="member-role-select"
                          value={member.role}
                          disabled={creating}
                          onChange={(event) =>
                            updateMemberRole(member.email, event.target.value)
                          }
                        >
                          {data.workspace.membership_role === "owner" && (
                            <option value="admin">Admin</option>
                          )}
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      ) : (
                        <span className="role-label">{member.role}</span>
                      )}
                      <span>{dateLabel(member.created_at)}</span>
                      {canManage ? (
                        <button
                          className="remove-member"
                          disabled={creating}
                          onClick={() => removeMember(member.email)}
                        >
                          Remove
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })}
              </section>
              {data.pendingInvitations.length > 0 && (
                <section className="saas-card pending-invitations">
                  <header>
                    <div>
                      <span>PENDING INVITATIONS</span>
                      <b>
                        Seats are reserved until accepted, revoked, or expired.
                      </b>
                    </div>
                  </header>
                  {data.pendingInvitations.map((invitation) => (
                    <div key={invitation.id}>
                      <span>
                        <b>{invitation.email}</b>
                        <small>Invited by {invitation.invited_by}</small>
                      </span>
                      <span className="role-label">{invitation.role}</span>
                      <span>Expires {dateLabel(invitation.expires_at)}</span>
                      <button
                        disabled={creating}
                        onClick={() => revokeInvitation(invitation.id)}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </section>
              )}
              <aside className="team-access-boundary">
                <b>Private pilot access</b>
                <p>
                  Send the one-time link securely. The invited email must also
                  be allowed through the private deployment sign-in gate.
                </p>
              </aside>
            </>
          )}
          {tab === "support" && (
            <>
              <SectionHeader
                eyebrow="SUPPORT"
                title="Get help"
                description="Open a tenant-linked case with the exact workspace and product context needed for follow-up."
              />
              <section className="support-grid">
                <form
                  className="saas-card support-form"
                  onSubmit={createSupport}
                >
                  <h3>Open a support case</h3>
                  <label>
                    Subject
                    <input
                      name="subject"
                      required
                      maxLength={120}
                      placeholder="What do you need help with?"
                    />
                  </label>
                  <div>
                    <label>
                      Category
                      <select name="category" defaultValue="product">
                        <option value="product">Product</option>
                        <option value="simulation">Simulation</option>
                        <option value="integration">Integration</option>
                        <option value="billing">Billing</option>
                        <option value="security">Security</option>
                      </select>
                    </label>
                    <label>
                      Priority
                      <select name="priority" defaultValue="normal">
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Details
                    <textarea
                      name="body"
                      required
                      maxLength={4000}
                      rows={7}
                      placeholder="Include the run ID, expected behavior, and impact. Never paste secrets."
                    />
                  </label>
                  {error && <p className="form-error">{error}</p>}
                  <button disabled={creating}>
                    {creating ? "Opening case…" : "Open support case →"}
                  </button>
                  <small>
                    Cases are visible to you and workspace administrators.
                  </small>
                </form>
                <section className="saas-card case-list">
                  <header>
                    <span>YOUR CASES</span>
                    <b>{data.supportCases.length} total</b>
                  </header>
                  {data.supportCases.map((item) => (
                    <article key={item.id}>
                      <span className={`case-priority ${item.priority}`}>
                        {item.priority}
                      </span>
                      <div>
                        <b>{item.subject}</b>
                        <small>
                          {item.id} · {item.category} · opened{" "}
                          {dateLabel(item.created_at)}
                        </small>
                      </div>
                      <em>{item.status}</em>
                    </article>
                  ))}
                  {!data.supportCases.length && (
                    <div className="case-empty">
                      <b>No support cases</b>
                      <p>New cases and their status will appear here.</p>
                    </div>
                  )}
                </section>
              </section>
            </>
          )}
          {tab === "settings" && (
            <>
              <SectionHeader
                eyebrow="SETTINGS"
                title="Workspace settings"
                description="Manage workspace identity, safety defaults, and customer data controls."
              />
              <section className="settings-grid">
                <form className="saas-card" onSubmit={saveWorkspace}>
                  <h3>General</h3>
                  <label>
                    Workspace name
                    <input
                      name="name"
                      required
                      defaultValue={data.workspace.name}
                    />
                  </label>
                  <label>
                    Default branch
                    <input defaultValue="main" disabled />
                  </label>
                  <button disabled={creating}>
                    {creating ? "Saving…" : "Save changes"}
                  </button>
                </form>
                <article className="saas-card">
                  <h3>Simulation safety</h3>
                  <Toggle
                    title="Require approval before repair"
                    note="Human approval stays mandatory."
                  />
                  <Toggle
                    title="Block outbound network"
                    note="Mocks are used for external services."
                  />
                  <Toggle
                    title="Auto-delete environments"
                    note="Destroy after five minutes."
                  />
                </article>
                <article className="saas-card data-controls">
                  <h3>Data portability</h3>
                  <p>
                    {data.workspace.membership_role === "owner" ||
                    data.workspace.membership_role === "admin"
                      ? "Download workspace data without provider secrets."
                      : "Download your account-scoped support and activity data."}
                  </p>
                  <button onClick={() => (location.href = "/api/data/export")}>
                    Download JSON export ↓
                  </button>
                </article>
                <article className="saas-card data-controls danger-zone">
                  <h3>Workspace deletion review</h3>
                  {data.workspace.membership_role !== "owner" ? (
                    <p>
                      Only the workspace owner can request deletion. Contact
                      support for account-level requests.
                    </p>
                  ) : data.deletionRequests.find(
                      (item) => item.status === "pending",
                    ) ? (
                    <>
                      <p>
                        A deletion review is pending until{" "}
                        {dateLabel(
                          data.deletionRequests.find(
                            (item) => item.status === "pending",
                          )!.execute_after,
                        )}
                        . No data is deleted automatically during this review
                        window.
                      </p>
                      <button
                        disabled={creating}
                        onClick={() =>
                          cancelDeletion(
                            data.deletionRequests.find(
                              (item) => item.status === "pending",
                            )!.id,
                          )
                        }
                      >
                        Cancel deletion review
                      </button>
                    </>
                  ) : (
                    <form onSubmit={requestDeletion}>
                      <p>
                        This creates a reversible seven-day review request. It
                        does not immediately erase data.
                      </p>
                      <label>
                        Optional reason
                        <input
                          name="reason"
                          maxLength={500}
                          placeholder="Why are you closing this workspace?"
                        />
                      </label>
                      <button disabled={creating}>
                        Request deletion review
                      </button>
                    </form>
                  )}
                </article>
              </section>
            </>
          )}
        </div>
      </section>
      {showCreate && (
        <div className="saas-modal-backdrop">
          <section
            className="saas-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
          >
            <button
              className="saas-modal-close"
              onClick={() => setShowCreate(false)}
              aria-label="Close project dialog"
            >
              ×
            </button>
            <span>NEW SOFTWARE TWIN</span>
            <h2 id="create-title">Connect a repository</h2>
            <p>
              Manual entries remain ownership-unverified. For tenant-owned
              evidence and draft pull requests, connect and import the
              repository from the GitHub integration.
            </p>
            <form onSubmit={create}>
              <label>
                Project name
                <input name="name" required placeholder="Payments resilience" />
              </label>
              <label>
                Repository
                <input
                  name="repository"
                  required
                  placeholder="organization/repository"
                />
              </label>
              <label>
                Branch
                <input name="branch" defaultValue="main" />
              </label>
              {error && <p className="form-error">{error}</p>}
              <div>
                <button type="button" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button className="primary" disabled={creating}>
                  {creating ? "Creating…" : "Create project →"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {showInvite && (
        <div className="saas-modal-backdrop">
          <section
            className="saas-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-title"
          >
            <button
              className="saas-modal-close"
              onClick={() => {
                setShowInvite(false);
                setNewInviteLink("");
              }}
              aria-label="Close invite dialog"
            >
              ×
            </button>
            <span>WORKSPACE ACCESS</span>
            <h2 id="invite-title">Invite a team member</h2>
            <p>
              Create an identity-bound, one-time link that expires in seven
              days.
            </p>
            {newInviteLink ? (
              <div className="invite-secret">
                <b>COPY THIS LINK NOW</b>
                <p>
                  It is shown once and should be delivered only to the invited
                  person.
                </p>
                <code>{newInviteLink}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(newInviteLink)}
                >
                  Copy invitation link
                </button>
                <button
                  className="invite-done"
                  onClick={() => {
                    setShowInvite(false);
                    setNewInviteLink("");
                  }}
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={invite}>
                <label>
                  Email address
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="engineer@company.com"
                  />
                </label>
                <label>
                  Role
                  <select name="role" defaultValue="member">
                    <option value="member">Member</option>
                    {data.workspace.membership_role === "owner" && (
                      <option value="admin">Admin</option>
                    )}
                    <option value="viewer">Viewer</option>
                  </select>
                </label>
                {error && <p className="form-error">{error}</p>}
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowInvite(false);
                      setNewInviteLink("");
                    }}
                  >
                    Cancel
                  </button>
                  <button className="primary" disabled={creating}>
                    {creating ? "Creating…" : "Create invitation →"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
      {showUpgrade && (
        <div className="saas-modal-backdrop">
          <section
            className="upgrade-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upgrade-title"
          >
            <button
              className="saas-modal-close"
              onClick={() => setShowUpgrade(false)}
              aria-label="Close plans"
            >
              ×
            </button>
            <span>CHOOSE YOUR PLAN</span>
            <h2 id="upgrade-title">Reliability before production.</h2>
            <p>
              Payment details are collected securely through Stripe-hosted
              Checkout.
            </p>
            <div className="plans">
              <Plan
                name="STARTER"
                price="49"
                description="For individual developers."
                items={["150 simulation minutes", "3 projects", "1 seat"]}
                disabled={!data.configuration.billing.configured || creating}
                onChoose={() => checkout("starter")}
              />
              <Plan
                name="PRO"
                price="199"
                description="For startup engineering teams."
                items={[
                  "500 simulation minutes",
                  "10 projects",
                  "5 seats",
                  "Draft PRs + API access",
                ]}
                recommended
                disabled={!data.configuration.billing.configured || creating}
                onChoose={() => checkout("pro")}
              />
              <Plan
                name="BUSINESS"
                price="599"
                description="For reliability programs."
                items={[
                  "2,000 simulation minutes",
                  "Unlimited projects",
                  "20 seats",
                  "SSO + audit export",
                ]}
                disabled
                onChoose={() => {}}
              />
            </div>
            <small>
              {data.configuration.billing.configured
                ? "Subscriptions update automatically after signed Stripe webhook confirmation."
                : "Checkout becomes available after production Stripe prices and webhook credentials are configured."}
            </small>
          </section>
        </div>
      )}
    </main>
  );
}

function Kpi({
  label,
  value,
  suffix,
  note,
}: {
  label: string;
  value: string;
  suffix?: string;
  note: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>
        {value}
        {suffix && <small>{suffix}</small>}
      </strong>
      <em>{note}</em>
    </div>
  );
}
function CardHeader({
  eyebrow,
  title,
  action,
  onAction,
}: {
  eyebrow: string;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <header>
      <div>
        <span>{eyebrow}</span>
        <b>{title}</b>
      </div>
      {action && <button onClick={onAction}>{action}</button>}
    </header>
  );
}
function ProjectList({
  projects,
  onAll,
}: {
  projects: Project[];
  onAll: () => void;
}) {
  return (
    <section className="saas-card projects-card">
      <CardHeader
        eyebrow="PROJECTS"
        title="Your software twins"
        action="View all →"
        onAction={onAll}
      />
      {projects.map((project) => (
        <article key={project.id}>
          <div className="project-icon">◇</div>
          <div>
            <b>{project.name}</b>
            <small>
              ⌘ {project.repository} · {project.branch}
            </small>
            <em className={`repository-proof ${project.repository_verified ? "verified" : "unverified"}`}>
              {project.source_kind === "sample" ? "SAMPLE" : project.repository_verified ? "GITHUB VERIFIED" : "UNVERIFIED"}
            </em>
          </div>
          <span className={`saas-status ${project.status}`}>
            {statusLabel(project.status)}
          </span>
          <div
            className="score-ring"
            style={
              {
                "--score": `${project.resilience_score * 3.6}deg`,
              } as CSSProperties
            }
          >
            <b>{project.resilience_score}</b>
          </div>
          <button
            aria-label={`Open ${project.name}`}
            onClick={() => (location.href = "/")}
          >
            →
          </button>
        </article>
      ))}
    </section>
  );
}
function Activity({ events }: { events: AuditLog[] }) {
  return (
    <section className="saas-card activity-card">
      <CardHeader eyebrow="ACTIVITY" title="Recent events" />
      <ol>
        {events.map((event) => (
          <li key={event.id}>
            <i
              className={
                event.action.includes("verified")
                  ? "green"
                  : event.action.includes("completed")
                    ? "red"
                    : "purple"
              }
            >
              {event.action.includes("verified")
                ? "✓"
                : event.action.includes("completed")
                  ? "!"
                  : "✦"}
            </i>
            <div>
              <b>{event.summary}</b>
              <p>{event.actor_email}</p>
              <small>{dateLabel(event.created_at)}</small>
            </div>
          </li>
        ))}
        {!events.length && (
          <li>
            <i className="purple">◉</i>
            <div>
              <b>Audit trail ready</b>
              <p>Material workspace actions will appear here.</p>
              <small>Now</small>
            </div>
          </li>
        )}
      </ol>
    </section>
  );
}
function SectionHeader({
  eyebrow,
  title,
  description,
  action,
  onAction,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <section className="section-header">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && (
        <button onClick={onAction}>
          {action} <b>→</b>
        </button>
      )}
    </section>
  );
}
function RunTable({ runs }: { runs: Run[] }) {
  return (
    <div className="run-table">
      <header>
        <span>SCENARIO</span>
        <span>STATUS</span>
        <span>SCORE</span>
        <span>JOURNEY</span>
        <span>DATE</span>
        <span></span>
      </header>
      {runs.map((run) => (
        <article key={run.id}>
          <div>
            <i>
              {run.scenario.includes("Payment")
                ? "⚡"
                : run.scenario.includes("Database")
                  ? "▤"
                  : "↗"}
            </i>
            <span>
              <b>{run.scenario}</b>
              <small>{run.project_name} · {run.evidence_kind === "observed" ? "observed" : run.evidence_kind === "sample_fixture" ? "sample" : "modeled"}</small>
            </span>
          </div>
          <span className={`saas-status ${run.status}`}>
            {statusLabel(run.status)}
          </span>
          <span className="run-score">
            <b>{run.before_score}</b>
            {run.after_score && (
              <>
                <em>→</em>
                <strong>{run.after_score}</strong>
              </>
            )}
          </span>
          <span>{run.journey_success}%</span>
          <span>{dateLabel(run.created_at)}</span>
          <button
            aria-label={
              run.status === "verified"
                ? `Download ${run.scenario} report`
                : `Open ${run.scenario}`
            }
            onClick={() =>
              (location.href =
                run.status === "verified"
                  ? `/api/reports?run=${encodeURIComponent(run.id)}`
                  : "/")
            }
          >
            {run.status === "verified" ? "↓" : "→"}
          </button>
        </article>
      ))}
    </div>
  );
}
function Toggle({ title, note }: { title: string; note: string }) {
  return (
    <label className="toggle-row">
      <span>
        <b>{title}</b>
        <small>{note}</small>
      </span>
      <input type="checkbox" defaultChecked />
    </label>
  );
}
function Plan({
  name,
  price,
  description,
  items,
  recommended,
  disabled,
  onChoose,
}: {
  name: string;
  price: string;
  description: string;
  items: string[];
  recommended?: boolean;
  disabled?: boolean;
  onChoose: () => void;
}) {
  return (
    <article className={recommended ? "recommended" : ""}>
      {recommended && <b>MOST POPULAR</b>}
      <span>{name}</span>
      <strong>
        ${price}
        <small>/month</small>
      </strong>
      <p>{description}</p>
      <ul>
        {items.map((item) => (
          <li key={item}>✓ {item}</li>
        ))}
      </ul>
      <button disabled={disabled} onClick={onChoose}>
        {name === "BUSINESS"
          ? "Contact sales"
          : `Choose ${name[0] + name.slice(1).toLowerCase()}`}
      </button>
    </article>
  );
}
