"use client";

import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import "./project.css";
import "./project-controls.css";
import "./project-polish.css";

type Row = Record<string, unknown>;
type ExecutionReadiness = { ready: boolean; backend: string; code: string; message: string; missing: string[] };
type Snapshot = { project: Row; scans: Row[]; models: Row[]; environments: Row[]; journeys: Row[]; conversations: Row[]; campaigns: Row[]; campaignRuns: Row[]; runs: Row[]; investigations: Row[]; candidates: Row[]; reports: Row[]; execution: ExecutionReadiness };
type Tab = "overview" | "model" | "environment" | "journeys" | "assistant" | "campaigns" | "runs" | "repairs";

const nav: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "⌂" }, { id: "model", label: "System model", icon: "◇" },
  { id: "environment", label: "Environment", icon: "▣" }, { id: "journeys", label: "Journeys", icon: "↝" },
  { id: "assistant", label: "AI assistant", icon: "✦" }, { id: "campaigns", label: "Campaigns", icon: "▦" },
  { id: "runs", label: "Runs & replay", icon: "▶" }, { id: "repairs", label: "Repair arena", icon: "⌁" },
];

function parse(value: unknown, fallback: unknown = {}) { try { return JSON.parse(String(value || "")); } catch { return fallback; } }
function nodes(snapshot: Snapshot | null) { const model = snapshot?.models[0]; return (parse(model?.graph_json || snapshot?.project.graph_json, { nodes: [] }) as { nodes?: Row[] }).nodes || []; }

export default function ProjectWorkspace() {
  const projectId = String(useParams<{ projectId: string }>().projectId || "");
  const [data, setData] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/worldmodel?projectId=${encodeURIComponent(projectId)}`);
    const payload = await response.json() as Snapshot & { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || "Unable to load project");
    setData(payload);
  }, [projectId]);

  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((reason) => setError(reason.message)).finally(() => setLoading(false)); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { const sync = () => { const value = location.hash.slice(1) as Tab; if (nav.some((item) => item.id === value)) setTab(value); }; sync(); addEventListener("hashchange", sync); return () => removeEventListener("hashchange", sync); }, []);
  useEffect(() => {
    if (loading || !window.matchMedia("(max-width: 700px)").matches) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    document.querySelector<HTMLElement>(`[data-project-tab="${tab}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior });
  }, [loading, tab]);

  async function mutate(action: string, payload: Row = {}) {
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/v1/worldmodel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, projectId, ...payload }) });
      const body = await response.json() as { result?: unknown; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "Action failed");
      await load(); return body.result;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Action failed"); throw reason; }
    finally { setWorking(false); }
  }

  function runMutation(
    action: string,
    payload: Row,
    onSuccess: (result: unknown) => void,
  ) {
    void mutate(action, payload).then(onSuccess).catch(() => undefined);
  }

  if (loading) return <main className="project-loading"><span>WORLDMODEL</span><h1>Loading software twin…</h1></main>;
  if (!data) return <main className="project-loading error"><h1>Project unavailable</h1><p>{error}</p><a href="/dashboard">Return to workspace</a></main>;
  const model = data.models[0];
  const environment = data.environments[0];
  const projectNodes = nodes(data);
  const setup = [model?.status === "approved", environment?.status === "approved", data.journeys.some((item) => item.status === "approved")];

  return <main className="project-shell">
    <aside className="project-sidebar">
      <a className="project-brand" href="/dashboard"><span className="project-logo">◈</span><b>WorldModel</b></a>
      <a className="back-workspace" href="/dashboard">← Workspace</a>
      <div className="project-identity"><span>{String(data.project.name || "WM").slice(0,2).toUpperCase()}</span><div><b>{String(data.project.name)}</b><small>{String(data.project.repository)}</small></div></div>
      <nav aria-label="Project navigation">{nav.map((item) => <button key={item.id} data-project-tab={item.id} className={`project-nav-button ${tab === item.id ? "active" : ""}`} aria-current={tab === item.id ? "page" : undefined} onClick={() => { setTab(item.id); history.replaceState(null, "", `#${item.id}`); }}><i>{item.icon}</i>{item.label}{item.id === "campaigns" && data.campaigns.length > 0 && <em>{data.campaigns.length}</em>}</button>)}</nav>
      <div className="project-sidebar-foot"><span>EXECUTION EVIDENCE</span><b>{data.runs.length ? `${data.runs.length} observed runs` : "No observed runs yet"}</b><small>Modeled data never counts as customer evidence.</small></div>
    </aside>
    <section className="project-main">
      <header className="project-topbar"><div><span>{String(data.project.repository)}</span><i>/</i><b>{nav.find((item) => item.id === tab)?.label}</b></div><div><span className={`project-state ${String(data.project.status)}`}><i />{String(data.project.status).replaceAll("_", " ")}</span><button onClick={() => void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to refresh project"))} aria-label="Refresh">↻</button></div></header>
      <div className="project-content">
        {error && <div className="project-alert error" role="alert"><b>Action required</b><span>{error}</span><button onClick={() => setError("")}>×</button></div>}
        {notice && <div className="project-alert"><b>Saved</b><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}
        {tab === "overview" && <Overview data={data} setup={setup} onTab={setTab} />}
        {tab === "model" && <ModelView model={model} scans={data.scans} projectNodes={projectNodes} working={working} approve={() => runMutation("approve-model", { modelVersionId: model?.id, overrides: {} }, () => setNotice("System model approved."))} rescan={() => runMutation("rescan-repository", {}, () => setNotice("Exact-commit scan queued."))} />}
        {tab === "environment" && <EnvironmentView data={data} model={model} environment={environment} working={working} save={(payload) => runMutation("save-environment", payload, () => setNotice("Environment manifest approved."))} />}
        {tab === "journeys" && <JourneysView journeys={data.journeys} working={working} create={(definition) => runMutation("create-journey", { definition, approve: true }, () => setNotice("Critical journey approved."))} />}
        {tab === "assistant" && <AssistantView ready={setup.every(Boolean)} working={working} campaigns={data.campaigns} send={(message, conversationId) => mutate("assistant-message", { message, conversationId })} onCampaigns={() => setTab("campaigns")} />}
        {tab === "campaigns" && <CampaignControlView projectId={projectId} campaigns={data.campaigns} execution={data.execution} working={working} configure={() => { setTab("environment"); history.replaceState(null, "", "#environment"); }} approve={(campaignId) => runMutation("approve-campaign", { campaignId }, () => setNotice("Campaign approved and queued for durable execution."))} cancel={(campaignId) => runMutation("cancel-campaign", { campaignId }, () => setNotice("Cancellation requested. Active runners will tear down before the workflow closes."))} />}
        {tab === "runs" && <LiveRunsView projectId={projectId} projectNodes={projectNodes} runs={data.runs} campaignRuns={data.campaignRuns} />}
        {tab === "repairs" && <RepairTournamentView runs={data.runs} investigations={data.investigations} candidates={data.candidates} reports={data.reports} working={working} start={(runId, objective) => runMutation("start-investigation", { runId, objective }, () => setNotice("Investigation and three-candidate tournament queued."))} share={(reportId) => runMutation("share-report", { reportId }, (result) => setNotice(`Private read-only link: ${window.location.origin}${String((result as Row).path)}`))} approve={(reportId) => runMutation("approve-report", { reportId, decisionNote: "Approved after reviewing the identical replay, hard gates, evidence, and residual risks." }, () => setNotice("Report approved. No repository write has occurred."))} publish={(reportId) => runMutation("publish-draft-pr", { reportId }, (result) => setNotice(`Draft PR published: ${String((result as Row).url)}`))} />}
      </div>
    </section>
  </main>;
}

function Overview({ data, setup, onTab }: { data: Snapshot; setup: boolean[]; onTab: (tab: Tab) => void }) {
  const steps: Array<[string, string, Tab]> = [["Approve the system model", "Confirm detected components and source evidence", "model"], ["Approve the execution environment", "Review every command before code runs", "environment"], ["Define a critical journey", "Measure an actual user outcome", "journeys"]];
  return <><section className="project-hero"><div><span>SOFTWARE TWIN</span><h1>{String(data.project.name)}</h1><p>Turn repository evidence into controlled, repeatable resilience decisions.</p></div><button onClick={() => onTab("assistant")} disabled={!setup.every(Boolean)}>✦ Plan a test campaign <b>→</b></button></section>
    <section className="project-metrics"><article><span>MODEL COMPONENTS</span><b>{nodes(data).length}</b><small>{data.models.length ? "Versioned repository evidence" : "Scan required"}</small></article><article><span>CRITICAL JOURNEYS</span><b>{data.journeys.length}</b><small>{data.journeys.filter((x) => x.status === "approved").length} approved</small></article><article><span>OBSERVED RUNS</span><b>{data.runs.length}</b><small>Signed runner evidence only</small></article><article><span>CAMPAIGNS</span><b>{data.campaigns.length}</b><small>Maximum 20 runs each</small></article></section>
    {!setup.every(Boolean) && <section className="activation-panel"><header><div><span>PROJECT ACTIVATION</span><h2>Make this twin executable</h2></div><strong>{setup.filter(Boolean).length}/{setup.length}</strong></header><ol>{steps.map(([title, note, target], index) => <li className={setup[index] ? "done" : index === setup.findIndex((value) => !value) ? "active" : ""} key={title}><i>{setup[index] ? "✓" : index + 1}</i><div><b>{title}</b><small>{note}</small></div>{!setup[index] && <button onClick={() => onTab(target)}>Open →</button>}</li>)}</ol></section>}
    <section className="truth-panel"><div><span>EVIDENCE POLICY</span><h2>No simulated customer results.</h2><p>WorldModel only promotes metrics into project history after a configured runner submits observed evidence with an immutable scenario fingerprint, seed, environment revision, and teardown attestation.</p></div><ul><li>✓ Exact commit and model version</li><li>✓ Approved commands and resource bounds</li><li>✓ Refresh-safe events and artifacts</li><li>✓ Explicit approval before repository writes</li></ul></section></>;
}

function ModelView({ model, scans, projectNodes, working, approve, rescan }: { model?: Row; scans: Row[]; projectNodes: Row[]; working: boolean; approve: () => void; rescan: () => void }) {
  return <section><PageHead eyebrow="REPOSITORY MODEL" title="Review the detected system" description="Every component must point back to repository evidence. Unknowns remain unknown until runtime validation." action={scans.some((scan) => ["queued", "running", "dispatching"].includes(String(scan.status))) ? "Scan in progress" : "Rescan exact commit"} onAction={rescan} />
    {!model ? <Empty title="Repository scan has not produced a model" text="Reconnect or rescan this GitHub repository. WorldModel will not invent an architecture while the durable scanner is unavailable." action="Open GitHub integration" href="/dashboard?tab=integrations" /> : <><div className="model-summary"><div><span>COMMIT</span><code>{String(model.commit_sha)}</code></div><div><span>CONFIDENCE</span><b>{String(model.confidence)}%</b></div><div><span>COMPONENTS</span><b>{projectNodes.length}</b></div><div><span>STATUS</span><b className={model.status === "approved" ? "good" : "warn"}>{String(model.status)}</b></div></div><div className="model-layout"><div className="model-canvas"><div className="model-grid" />{projectNodes.slice(0, 16).map((node, index) => <article key={String(node.id)} style={{ "--model-left": `${12 + (index % 4) * 25}%`, "--model-top": `${18 + Math.floor(index / 4) * 24}%`, "--model-mobile-left": `${25 + (index % 2) * 50}%`, "--model-mobile-top": `${7 + Math.floor(index / 2) * 12.5}%` } as CSSProperties}><i>{node.kind === "datastore" ? "▤" : node.kind === "journey" ? "↝" : "◇"}</i><span><b>{String(node.name)}</b><small>{String(node.kind)}</small></span><em className={node.confidence === "observed" ? "observed" : "inferred"} /></article>)}</div><aside className="evidence-list"><span>SOURCE EVIDENCE</span>{projectNodes.slice(0, 10).map((node) => <div key={String(node.id)}><b>{String(node.name)}</b><code>{String((node.evidence as string[] | undefined)?.[0] || node.path || "No evidence")}</code><small>{String(node.confidence || "unknown")}</small></div>)}</aside></div>{model.status !== "approved" && <div className="sticky-action"><div><b>Human approval required</b><span>Approval freezes this graph as the environment basis.</span></div><button disabled={working} onClick={approve}>{working ? "Saving…" : "Approve model →"}</button></div>}</>}
  </section>;
}

function defaultManifest(model: Row | undefined, data: Snapshot) {
  const graph = parse(model?.graph_json || data.project.graph_json, { nodes: [] }) as { nodes?: Row[] };
  const apps = (graph.nodes || []).filter((node) => ["application", "service"].includes(String(node.kind))).slice(0, 5);
  return { version: 1, packageManager: "npm", nodeVersion: "22", install: "npm ci", services: (apps.length ? apps : [{ id: "app", name: data.project.name }]).map((node, index) => ({ id: String(node.id || `service_${index}`).replace(/^cmp_/, "").slice(0, 60), name: String(node.name || "Application"), root: String(node.path || "."), start: "npm run dev", port: 3000 + index, healthCheck: "/health", dependsOn: [] })), testCommands: ["npm test"], journeyCommands: ["npx playwright test"], mocks: [], secretRefs: [], supportedFaults: ["traffic_surge", "dependency_outage", "database_latency"], resources: { cpu: 1, memoryMb: 1024, timeoutSeconds: 300, network: "registries" } };
}

function EnvironmentView({ data, model, environment, working, save }: { data: Snapshot; model?: Row; environment?: Row; working: boolean; save: (payload: Row) => void }) {
  const [manifest, setManifest] = useState(() => JSON.stringify(environment ? parse(environment.manifest_json) : defaultManifest(model, data), null, 2));
  const [manifestError, setManifestError] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); setManifestError(""); try { save({ modelVersionId: model?.id, backend: "github_actions", manifest: JSON.parse(manifest), approve: true }); } catch { setManifestError("Manifest must be valid JSON before it can be validated."); } }
  return <section><PageHead eyebrow="EXECUTION ENVIRONMENT" title="Review exactly what will run" description="Repository commands remain blocked until this manifest is approved and the customer-controlled GitHub Actions runner is configured." />
    {environment && <ExecutionReadinessCard projectId={String(data.project.id)} execution={data.execution} />}
    {!model || model.status !== "approved" ? <Empty title="Approve the system model first" text="Environment commands must be pinned to an approved commit and graph version." action="Review model" href="#model" /> : <form className="environment-form" onSubmit={submit}><div className="backend-cards"><div className="backend-option selected"><span>SUPPORTED RUNNER</span><b>GitHub Actions</b><small>Customer-controlled execution with short-lived OIDC credentials</small></div></div><label><span>WORLDMODEL MANIFEST</span><textarea spellCheck={false} value={manifest} onChange={(event) => setManifest(event.target.value)} /></label>{manifestError && <p className="form-error" role="alert">{manifestError}</p>}<div className="safety-grid"><div><b>Command allowlist</b><span>npm, pnpm, Yarn, and npx only</span></div><div><b>Resource ceiling</b><span>4 CPU · 8 GB · 60 minutes</span></div><div><b>Network</b><span>Deny or package registries only</span></div><div><b>Cleanup</b><span>Required on every terminal state</span></div></div><div className="sticky-action"><div><b>{environment?.status === "approved" ? "Approved environment revision" : "Approval creates an immutable revision"}</b><span>Changing commands later creates a new revision.</span></div><button disabled={working}>{working ? "Validating…" : "Validate & approve →"}</button></div></form>}
  </section>;
}

function JourneysView({ journeys, working, create }: { journeys: Row[]; working: boolean; create: (definition: Row) => void }) {
  const [show, setShow] = useState(journeys.length === 0);
  const [name, setName] = useState("Critical checkout");
  const [importance, setImportance] = useState("critical");
  const [latencyThresholdMs, setLatencyThresholdMs] = useState("2000");
  const [allowedErrorRate, setAllowedErrorRate] = useState("1");
  const [entryPath, setEntryPath] = useState("/");
  const [successAssertion, setSuccessAssertion] = useState("User sees a success state");
  const [command, setCommand] = useState("npx playwright test");
  function submit(event: FormEvent) {
    event.preventDefault();
    create({
      name,
      importance,
      steps: [
        { name: `Open ${entryPath}`, assertion: "Page responds successfully" },
        { name: "Complete critical action", assertion: successAssertion },
      ],
      latencyThresholdMs: Number(latencyThresholdMs),
      allowedErrorRate: Number(allowedErrorRate),
      command,
    });
    setShow(false);
  }
  return <section><PageHead eyebrow="CRITICAL JOURNEYS" title="Measure outcomes, not only services" description="A run is meaningful only when it proves whether a real user or API workflow succeeded." action="＋ New journey" onAction={() => setShow(true)} />
    {show && <form className="journey-form" onSubmit={submit}><label>Journey name<input name="journeyName" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><div><label>Importance<select name="importance" value={importance} onChange={(event) => setImportance(event.target.value)}><option value="critical">Critical</option><option value="high">High</option><option value="standard">Standard</option></select></label><label>Latency SLO (ms)<input name="latencyThresholdMs" type="number" min="100" max="120000" required value={latencyThresholdMs} onChange={(event) => setLatencyThresholdMs(event.target.value)} /></label><label>Allowed errors (%)<input name="allowedErrorRate" type="number" min="0" max="100" step="0.1" required value={allowedErrorRate} onChange={(event) => setAllowedErrorRate(event.target.value)} /></label></div><div><label>Entry path<input name="entryPath" required maxLength={500} value={entryPath} onChange={(event) => setEntryPath(event.target.value)} /></label><label>Success assertion<input name="successAssertion" required maxLength={500} value={successAssertion} onChange={(event) => setSuccessAssertion(event.target.value)} /></label><label>Journey command<input name="command" required maxLength={500} value={command} onChange={(event) => setCommand(event.target.value)} /></label></div><p>The journey uses the repository&apos;s approved browser test command. The assistant can propose a generated test diff after the environment validates.</p><button disabled={working}>{working ? "Approving…" : "Approve journey →"}</button></form>}
    <div className="journey-grid">{journeys.map((row) => { const item = parse(row.definition_json) as Row; return <article key={String(row.id)}><header><span>{String(item.importance).toUpperCase()}</span><b className="good">{String(row.status)}</b></header><h3>{String(item.name)}</h3><p>{(item.steps as Row[] || []).length} ordered assertions · {String(item.command)}</p><ol>{(item.steps as Row[] || []).map((step, index) => <li key={index}><i>{index + 1}</i><span><b>{String(step.name)}</b><small>{String(step.assertion)}</small></span></li>)}</ol></article>; })}</div>
    {!journeys.length && !show && <Empty title="No critical journeys" text="Create one manually or ask the assistant to draft a Playwright journey for review." action="Create journey" href="#journeys" />}
  </section>;
}

function AssistantView({ ready, working, campaigns, send, onCampaigns }: { ready: boolean; working: boolean; campaigns: Row[]; send: (message: string, conversationId?: string) => Promise<unknown>; onCampaigns: () => void }) {
  const [message, setMessage] = useState("Test every critical journey under a 20× traffic spike, a 45-second dependency outage, and 800ms database latency. Include combined failures and recovery checks.");
  const [reply, setReply] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); const result = await send(message) as { summary?: string }; setReply(result?.summary || "Campaign draft created."); }
  return <section className="assistant-page"><PageHead eyebrow="PROJECT AI" title="Plan many tests in one conversation" description="The assistant can inspect approved project evidence and draft a bounded campaign. It cannot execute or write to GitHub without approval." />
    {!ready ? <Empty title="Finish project activation" text="Approve a model, environment, and critical journey before the assistant can produce executable scenarios." action="Review setup" href="#overview" /> : <div className="assistant-layout"><div className="chat-thread"><div className="assistant-message"><i>✦</i><div><b>WorldModel Scenario Copilot</b><p>I can create a campaign of up to 20 traffic, dependency, database, combined-failure, and recovery runs. I will show cost and assumptions before anything executes.</p></div></div>{reply && <div className="assistant-message result"><i>✓</i><div><b>Campaign draft ready</b><p>{reply}</p><button onClick={onCampaigns}>Review campaign →</button></div></div>}<form onSubmit={submit}><textarea value={message} onChange={(event) => setMessage(event.target.value)} /><footer><span>✦ Structured scenarios · evidence only</span><button disabled={working || !message.trim()}>{working ? "Planning…" : "Draft campaign ↑"}</button></footer></form></div><aside><span>ASSISTANT PERMISSIONS</span><ul><li><i>✓</i>Read approved model</li><li><i>✓</i>Read journeys and evidence</li><li><i>✓</i>Draft up to 20 scenarios</li><li><i>—</i>Cannot execute without approval</li><li><i>—</i>Cannot publish or merge</li></ul><div><b>{campaigns.length}</b><span>campaign drafts</span></div></aside></div>}
  </section>;
}

function CampaignsView({ campaigns, working, approve }: { campaigns: Row[]; working: boolean; approve: (id: string) => void }) {
  return <section><PageHead eyebrow="TEST CAMPAIGNS" title="One approval, many controlled runs" description="Every scenario is immutable after approval and executes with the same model, environment, resource policy, and evidence contract." />
    <div className="campaign-list">{campaigns.map((campaign) => { const plan = parse(campaign.plan_json) as { scenarios?: Row[]; assumptions?: string[] }; return <article key={String(campaign.id)}><header><div><span>{String(campaign.status).toUpperCase()}</span><h3>{String(campaign.name)}</h3><p>{String(campaign.objective)}</p></div><div><b>{plan.scenarios?.length || 0}</b><small>runs</small></div></header><div className="campaign-facts"><span><b>{String(campaign.concurrency)}</b> concurrent</span><span><b>{String(campaign.estimated_minutes)}m</b> estimated</span><span><b>Observed</b> evidence required</span></div><div className="scenario-chips">{plan.scenarios?.slice(0, 8).map((scenario, index) => <span key={index}>{String(scenario.name || `Scenario ${index + 1}`)}</span>)}</div>{campaign.status === "draft" && <footer><p>Approval authorizes these runs only. Repository writes remain separately gated.</p><button disabled={working} onClick={() => approve(String(campaign.id))}>{working ? "Queuing…" : "Approve & run campaign →"}</button></footer>}</article>; })}</div>
    {!campaigns.length && <Empty title="No campaigns yet" text="Ask the project AI to turn a reliability objective into an editable multi-run plan." action="Open AI assistant" href="#assistant" />}
  </section>;
}

function RunsView({ runs }: { runs: Row[] }) { return <section><PageHead eyebrow="OBSERVED EVIDENCE" title="Run history and replay" description="Only signed evidence from the configured GitHub Actions runner appears here." /><div className="run-table"><header><span>RUN</span><span>SCENARIO</span><span>STATUS</span><span>ERROR RATE</span><span>P95</span><span>JOURNEY</span></header>{runs.map((run) => <article key={String(run.id)}><code>{String(run.id).slice(0, 18)}</code><b>{String(run.scenario)}</b><span className="good">● {String(run.status)}</span><span>{String(run.error_rate)}</span><span>{String(run.latency_ms)}ms</span><span>{String(run.journey_success)}%</span></article>)}</div>{!runs.length && <Empty title="No observed runs" text="Modeled and sample results are intentionally excluded. Approve a campaign after configuring a durable runner." action="Review campaigns" href="#campaigns" />}</section>; }
function ExecutionReadinessCard({ projectId, execution, compact = false, configure }: { projectId: string; execution: ExecutionReadiness; compact?: boolean; configure?: () => void }) {
  return <aside className={`execution-readiness ${execution.ready ? "ready" : "blocked"} ${compact ? "compact" : ""}`} role="status">
    <i aria-hidden="true">{execution.ready ? "✓" : "!"}</i>
    <div><span>{execution.ready ? "RUNNER READY" : "RUNNER SETUP REQUIRED"}</span><b>{execution.backend === "github_actions" ? "GitHub Actions" : "No supported runner selected"}</b><p>{execution.message}</p>{!execution.ready && execution.missing.length > 0 && <small>Missing: {execution.missing.join(" · ")}</small>}</div>
    {!execution.ready && <div className="execution-actions">{configure && <button type="button" onClick={configure}>Review environment</button>}<a href={`/api/runner/workflow?project=${encodeURIComponent(projectId)}`}>Download Actions workflow</a></div>}
  </aside>;
}

function CampaignControlView({ projectId, campaigns, execution, working, configure, approve, cancel }: { projectId: string; campaigns: Row[]; execution: ExecutionReadiness; working: boolean; configure: () => void; approve: (id: string) => void; cancel: (id: string) => void }) {
  return <section><PageHead eyebrow="TEST CAMPAIGNS" title="One approval, many controlled runs" description="Every approved scenario is immutable and uses the same evidence contract." />
    <ExecutionReadinessCard projectId={projectId} execution={execution} configure={configure} />
    <div className="campaign-list">{campaigns.map((campaign) => { const plan = parse(campaign.plan_json) as { scenarios?: Row[] }; const status = String(campaign.status); const active = ["dispatching", "queued", "running"].includes(status); const approvable = ["draft", "dispatch_failed"].includes(status); return <article key={String(campaign.id)}><header><div><span>{status.replaceAll("_", " ").toUpperCase()}</span><h3>{String(campaign.name)}</h3><p>{String(campaign.objective)}</p></div><div><b>{plan.scenarios?.length || 0}</b><small>runs</small></div></header><div className="campaign-facts"><span><b>{String(campaign.concurrency)}</b> concurrent</span><span><b>{String(campaign.estimated_minutes)}m</b> estimated</span><span><b>Observed</b> evidence required</span></div><div className="scenario-chips">{plan.scenarios?.slice(0, 8).map((scenario, index) => <span key={index}>{String(scenario.name || `Scenario ${index + 1}`)}</span>)}</div>{approvable && <footer><p>{status === "dispatch_failed" ? "The prior dispatch created no observed evidence. It can be safely retried after runner setup." : "Approval authorizes these runs only. Repository writes remain separately gated."}</p>{execution.ready ? <button disabled={working} onClick={() => approve(String(campaign.id))}>{working ? "Queuing..." : status === "dispatch_failed" ? "Retry campaign" : "Approve and run campaign"}</button> : <button type="button" onClick={configure}>Configure execution</button>}</footer>}{active && <footer><p>Cancellation requests runner teardown and preserves recorded evidence.</p><button className="danger" disabled={working} onClick={() => cancel(String(campaign.id))}>Cancel campaign</button></footer>}</article>; })}</div>
    {!campaigns.length && <Empty title="No campaigns yet" text="Ask the project AI to turn a reliability objective into an editable multi-run plan." action="Open AI assistant" href="#assistant" />}
  </section>;
}

function LiveRunsView({ projectId, projectNodes, runs, campaignRuns }: { projectId: string; projectNodes: Row[]; runs: Row[]; campaignRuns: Row[] }) {
  const all = [...campaignRuns.filter((candidate) => !runs.some((run) => run.id === candidate.id)), ...runs];
  const [selected, setSelected] = useState(String(all[0]?.id || ""));
  return <section><PageHead eyebrow="OBSERVED EVIDENCE" title="Live run and replay" description="Ordered events survive refresh. Metrics become observed only after signed runner evidence passes verification." /><div className="run-table"><header><span>RUN</span><span>SCENARIO</span><span>STATUS</span><span>ERROR RATE</span><span>P95</span><span>JOURNEY</span></header>{all.map((run) => { const scenario = parse(run.scenario_json) as Row; return <article key={String(run.id)} onClick={() => setSelected(String(run.id))} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(String(run.id)); } }} tabIndex={0} role="button" aria-label={`Open replay for ${String(run.scenario || scenario.name || `scenario ${Number(run.scenario_index) + 1}`)}`}><code>{String(run.id).slice(0, 18)}</code><b>{String(run.scenario || scenario.name || `Scenario ${Number(run.scenario_index) + 1}`)}</b><span className="good">{String(run.status)}</span><span>{run.error_rate == null ? "Pending" : String(run.error_rate)}</span><span>{run.latency_ms == null ? "-" : `${String(run.latency_ms)}ms`}</span><span>{run.journey_success == null ? "-" : `${String(run.journey_success)}%`}</span></article>; })}</div>{selected && <LiveReplay key={selected} projectId={projectId} runId={selected} projectNodes={projectNodes} />}{!all.length && <Empty title="No runs yet" text="Modeled and sample results are excluded. Approve a campaign after configuring a durable runner." action="Review campaigns" href="#campaigns" />}</section>;
}

function LiveReplay({ projectId, runId, projectNodes }: { projectId: string; runId: string; projectNodes: Row[] }) {
  const [events, setEvents] = useState<Row[]>([]);
  useEffect(() => { let active = true; let after = 0; const poll = async () => { const response = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/events?projectId=${encodeURIComponent(projectId)}&after=${after}`); const body = await response.json() as { events?: Row[] }; if (active && response.ok && body.events?.length) { after = Number(body.events.at(-1)?.sequence || after); setEvents((current) => [...current, ...body.events!]); } }; void poll(); const timer = window.setInterval(() => void poll(), 2000); return () => { active = false; window.clearInterval(timer); }; }, [projectId, runId]);
  const state = new Map<string, string>(); for (const event of events) { const serviceId = String(event.service_id || ""); if (!serviceId) continue; if (String(event.type).includes("failed")) state.set(serviceId, "failed"); else if (String(event.type).includes("degraded") || event.type === "threshold.breached") state.set(serviceId, "degraded"); else if (String(event.type).includes("recovered")) state.set(serviceId, "healthy"); }
  const selectedEvent = events.at(-1); const selectedPayload = parse(selectedEvent?.payload_json, selectedEvent?.payload || {}) as Row;
  return <div className="twin-replay" aria-live="polite"><section className="twin-canvas"><header><div><span>LIVE DIGITAL TWIN</span><b>{runId}</b></div><strong>{events.length ? "Observed stream" : "Waiting for runner"}</strong></header><div className="twin-nodes">{projectNodes.slice(0, 24).map((node) => { const health = state.get(String(node.id).replace(/^cmp_/, "")) || (events.length ? "unknown" : "unknown"); return <article key={String(node.id)} className={health} tabIndex={0}><i>{health === "healthy" ? "✓" : health === "degraded" ? "!" : health === "failed" ? "×" : "?"}</i><div><b>{String(node.name)}</b><small>{String(node.kind)} · {health}</small></div></article>; })}</div><footer><input aria-label="Replay position" type="range" min="0" max={Math.max(0, events.length - 1)} value={Math.max(0, events.length - 1)} readOnly /><span>{events.length ? new Date(String(events.at(-1)?.timestamp)).toLocaleTimeString() : "No events"}</span></footer></section><aside className="twin-inspector"><span>LATEST EVIDENCE</span><h3>{String(selectedEvent?.type || "No event selected")}</h3><p>{String(selectedEvent?.source || "Runner events will appear here.")}</p>{Object.entries(selectedPayload).slice(0, 8).map(([key, value]) => <div key={key}><b>{key}</b><code>{typeof value === "object" ? JSON.stringify(value) : String(value)}</code></div>)}</aside><section className="live-replay"><header><div><span>ORDERED EVENT REPLAY</span><b>Refresh-safe timeline</b></div><strong>{events.length} events</strong></header><div>{events.map((event) => <article key={String(event.sequence)}><code>{String(event.sequence).padStart(3, "0")}</code><time>{new Date(String(event.timestamp)).toLocaleTimeString()}</time><b>{String(event.type)}</b><span>{String(event.source)}</span></article>)}</div>{!events.length && <p>Waiting for the first durable runner event...</p>}</section></div>;
}

function RepairTournamentView({ runs, investigations, candidates, reports, working, start, share, approve, publish }: { runs: Row[]; investigations: Row[]; candidates: Row[]; reports: Row[]; working: boolean; start: (runId: string, objective: string) => void; share: (reportId: string) => void; approve: (reportId: string) => void; publish: (reportId: string) => void }) {
  const [runId, setRunId] = useState(String(runs[0]?.id || "")); const [objective, setObjective] = useState("balanced");
  return <section><PageHead eyebrow="REPAIR ARENA" title="Competing repairs, ranked by evidence" description="Minimal, resilience, and architecture candidates run independently. Deterministic hard gates decide which candidates can rank." />{!runs.length ? <Empty title="An observed run is required" text="WorldModel will not generate code changes without an observed run and linked evidence." action="Run a campaign" href="#campaigns" /> : <><div className="repair-placeholder"><div><span>INVESTIGATIONS</span><b>{investigations.length}</b></div><label>Replay basis<select value={runId} onChange={(event) => setRunId(event.target.value)}>{runs.map((run) => <option key={String(run.id)} value={String(run.id)}>{String(run.scenario)} - {String(run.id).slice(0, 12)}</option>)}</select></label><label>Optimization<select value={objective} onChange={(event) => setObjective(event.target.value)}><option value="balanced">Balanced</option><option value="smallest_change">Smallest change</option><option value="highest_resilience">Highest resilience</option><option value="lowest_operational_complexity">Lowest operational complexity</option></select></label><ol><li>1 Investigator links root cause to traces and source</li><li>2 Three isolated worktrees produce bounded candidates</li><li>3 Challenger adds an adversarial test</li><li>4 Identical replay applies hard gates and scoring</li><li>5 Human separately approves any draft PR</li></ol><button disabled={working} onClick={() => start(runId, objective)}>{working ? "Starting..." : "Start investigation"}</button></div><div className="candidate-grid">{candidates.map((candidate) => <article key={String(candidate.id)}><span>{String(candidate.strategy).toUpperCase()}</span><b>{String(candidate.score ?? 0)}</b><small>{String(candidate.status)}</small></article>)}</div>{reports.map((row) => { const report = parse(row.report_json) as Row; return <article className="decision-report" key={String(row.id)}><span>VERIFICATION REPORT · {String(row.status).toUpperCase()}</span><h3>{String(report.decision)}</h3><p>{String(report.rootCause)}</p><code>{String(report.scenarioFingerprint)}</code><footer><button disabled={working} onClick={() => share(String(row.id))}>Create private link</button>{row.status === "ready" && <button disabled={working} onClick={() => approve(String(row.id))}>Approve report</button>}{row.status === "approved" && <button disabled={working} onClick={() => publish(String(row.id))}>Publish draft PR</button>}</footer></article>; })}</>}</section>;
}

void CampaignsView; void RunsView;

function PageHead({ eyebrow, title, description, action, onAction }: { eyebrow: string; title: string; description: string; action?: string; onAction?: () => void }) { return <header className="page-head"><div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action && <button onClick={onAction}>{action}</button>}</header>; }
function Empty({ title, text, action, href }: { title: string; text: string; action: string; href?: string }) { return <div className="project-empty"><i>◇</i><h2>{title}</h2><p>{text}</p>{href ? <a href={href}>{action} →</a> : <span>{action}</span>}</div>; }
