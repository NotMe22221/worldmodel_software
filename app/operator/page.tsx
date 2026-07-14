"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import "./operator.css";

type Totals = {
  workspaces: number;
  customer_workspaces: number;
  sample_workspaces: number;
  members: number;
  simulations: number;
  verified_runs: number;
  open_cases: number;
  simulation_minutes: number;
  active_subscriptions: number;
};
type Workspace = {
  id: string;
  name: string;
  workspace_mode: "sample" | "customer";
  plan: string;
  simulation_minutes: number;
  monthly_limit: number;
  trial_ends_at: string;
  created_at: string;
  subscription_status: string | null;
  subscription_plan: string | null;
  current_period_end: string | null;
  member_count: number;
  project_count: number;
  verified_run_count: number;
  open_case_count: number;
};
type SupportCase = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  created_by: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  body: string;
  operator_note: string | null;
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};
type OperatorSnapshot = {
  operator: { email: string };
  totals: Totals;
  workspaces: Workspace[];
  supportCases: SupportCase[];
  generatedAt: string;
};

function date(value: string | null) {
  if (!value) return "—";
  const result = new Date(value);
  return Number.isNaN(result.getTime())
    ? "—"
    : result.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

export default function OperatorPage() {
  const [data, setData] = useState<OperatorSnapshot | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    const response = await fetch("/api/operator", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Operator console unavailable");
    setData(result);
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/operator", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Operator console unavailable");
        return result;
      })
      .then(setData)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Operator console unavailable");
      });
    return () => controller.abort();
  }, []);
  async function updateCase(event: FormEvent<HTMLFormElement>, caseId: string) {
    event.preventDefault();
    setSaving(caseId);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/operator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update-case",
          caseId,
          status: form.get("status"),
          note: form.get("note"),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to update support case");
      await load();
      setNotice(`${caseId} updated with workspace audit evidence.`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update support case",
      );
    } finally {
      setSaving("");
    }
  }
  if (!data)
    return (
      <main className="operator-gate">
        <div className="operator-mark">WM</div>
        <span>WORLDMODEL OPERATIONS</span>
        <h1>{error ? "Access restricted" : "Loading control plane…"}</h1>
        <p>
          {error ||
            "Calculating tenant health without impersonating customer workspaces."}
        </p>
        <Link href="/dashboard">Return to workspace →</Link>
      </main>
    );
  return (
    <main className="operator-shell">
      <header>
        <div>
          <span className="operator-mark">WM</span>
          <div>
            <b>WorldModel Operations</b>
            <small>Internal control plane · no impersonation</small>
          </div>
        </div>
        <nav>
          <Link href="/dashboard">Customer workspace</Link>
          <span>{data.operator.email}</span>
        </nav>
      </header>
      <section className="operator-content">
        {notice && (
          <button className="operator-notice" onClick={() => setNotice("")}>
            ✓ {notice}
            <span>×</span>
          </button>
        )}
        {error && (
          <button className="operator-error" onClick={() => setError("")}>
            ! {error}
            <span>×</span>
          </button>
        )}
        <div className="operator-title">
          <span>BUSINESS OPERATIONS</span>
          <h1>Tenant health and support</h1>
          <p>
            Read-only commercial telemetry plus audited support-case state
            changes. Customer sessions, secrets, and impersonation are
            intentionally unavailable.
          </p>
        </div>
        <section className="operator-metrics">
          <article>
            <span>CUSTOMER WORKSPACES</span>
            <strong>{data.totals.customer_workspaces}</strong>
            <small>{data.totals.sample_workspaces} sample · {data.totals.members} total members</small>
          </article>
          <article>
            <span>ACTIVE SUBSCRIPTIONS</span>
            <strong>{data.totals.active_subscriptions}</strong>
            <small>Stripe-confirmed states</small>
          </article>
          <article>
            <span>SIMULATIONS</span>
            <strong>{data.totals.simulations}</strong>
            <small>{data.totals.verified_runs} verified repairs</small>
          </article>
          <article>
            <span>OPEN CASES</span>
            <strong>{data.totals.open_cases}</strong>
            <small>{data.totals.simulation_minutes} minutes consumed</small>
          </article>
        </section>
        <section className="operator-panel tenant-panel">
          <header>
            <div>
              <span>TENANT PORTFOLIO</span>
              <b>{data.workspaces.length} workspaces</b>
            </div>
            <small>
              Updated {new Date(data.generatedAt).toLocaleTimeString()}
            </small>
          </header>
          <div className="operator-table tenant-table">
            <div className="table-head">
              <span>WORKSPACE</span>
              <span>LIFECYCLE</span>
              <span>USAGE</span>
              <span>PRODUCT</span>
              <span>SUPPORT</span>
            </div>
            {data.workspaces.map((workspace) => (
              <article key={workspace.id}>
                <span>
                  <b>{workspace.name}</b>
                  <small>
                    {workspace.workspace_mode === "sample" ? "SAMPLE" : "CUSTOMER"} · {workspace.id} · created {date(workspace.created_at)}
                  </small>
                </span>
                <span>
                  <b>{workspace.subscription_status || workspace.plan}</b>
                  <small>
                    {workspace.subscription_plan || "trial"} · ends{" "}
                    {date(
                      workspace.current_period_end || workspace.trial_ends_at,
                    )}
                  </small>
                </span>
                <span>
                  <b>
                    {workspace.simulation_minutes}/{workspace.monthly_limit} min
                  </b>
                  <small>{workspace.member_count} members</small>
                </span>
                <span>
                  <b>{workspace.project_count} projects</b>
                  <small>{workspace.verified_run_count} verified runs</small>
                </span>
                <span
                  className={
                    workspace.open_case_count ? "needs-attention" : "healthy"
                  }
                >
                  <b>{workspace.open_case_count}</b>
                  <small>open cases</small>
                </span>
              </article>
            ))}
          </div>
        </section>
        <section className="operator-panel cases-panel">
          <header>
            <div>
              <span>SUPPORT QUEUE</span>
              <b>Cross-tenant case operations</b>
            </div>
            <small>{data.supportCases.length} recent cases</small>
          </header>
          {data.supportCases.map((item) => (
            <details key={item.id} className={`operator-case ${item.priority}`}>
              <summary>
                <span className="case-priority">{item.priority}</span>
                <span>
                  <b>{item.subject}</b>
                  <small>
                    {item.workspace_name} · {item.created_by}
                  </small>
                </span>
                <span>
                  <b>{item.status.replaceAll("_", " ")}</b>
                  <small>
                    {item.id} · updated {date(item.updated_at)}
                  </small>
                </span>
                <em>⌄</em>
              </summary>
              <div className="case-detail">
                <section>
                  <span>CUSTOMER MESSAGE</span>
                  <p>{item.body}</p>
                  <small>
                    {item.category} · opened {date(item.created_at)}
                  </small>
                  {item.operator_note && (
                    <blockquote>
                      <b>Latest operator note</b>
                      <p>{item.operator_note}</p>
                      <small>{item.assigned_to || "Unassigned"}</small>
                    </blockquote>
                  )}
                </section>
                <form onSubmit={(event) => updateCase(event, item.id)}>
                  <label>
                    Status
                    <select name="status" defaultValue={item.status}>
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="waiting_on_customer">
                        Waiting on customer
                      </option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </label>
                  <label>
                    Operator note
                    <textarea
                      name="note"
                      required
                      minLength={5}
                      maxLength={1000}
                      defaultValue={item.operator_note || ""}
                      placeholder="Record the action, owner, and next step."
                    />
                  </label>
                  <button disabled={saving === item.id}>
                    {saving === item.id ? "Saving…" : "Save audited update →"}
                  </button>
                </form>
              </div>
            </details>
          ))}
          {!data.supportCases.length && (
            <div className="operator-empty">
              <b>No support cases</b>
              <p>Tenant-linked cases will appear here.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
