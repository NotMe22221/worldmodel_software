"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ScenarioKey = "traffic" | "database" | "payments";
type RunPhase = "ready" | "running" | "failed" | "repairing" | "repaired" | "verified";
type ProductView = "landing" | "setup" | "twin";

const scenarios = {
  traffic: {
    label: "Traffic spike",
    detail: "20× load · 2m duration",
    event: "20× traffic ramp started",
    target: "API Gateway",
    baseline: { score: 42, errors: "18.7%", latency: "2.84s", journey: "61%" },
    after: { score: 91, errors: "0.8%", latency: "612ms", journey: "99%" },
  },
  database: {
    label: "Database slowdown",
    detail: "+800ms · orders-db",
    event: "800ms latency injected",
    target: "Orders DB",
    baseline: { score: 38, errors: "21.4%", latency: "3.19s", journey: "54%" },
    after: { score: 88, errors: "1.2%", latency: "734ms", journey: "98%" },
  },
  payments: {
    label: "Payment outage",
    detail: "503s · 45s window",
    event: "Payment provider returning 503",
    target: "Stripe API",
    baseline: { score: 31, errors: "32.1%", latency: "4.06s", journey: "22%" },
    after: { score: 94, errors: "0.4%", latency: "488ms", journey: "100%" },
  },
} as const;

const nodes = [
  { id: "storefront", label: "Storefront", kind: "Next.js", x: 10, y: 42, file: "apps/web/app/checkout/page.tsx" },
  { id: "gateway", label: "API Gateway", kind: "Fastify", x: 31, y: 42, file: "apps/api/src/server.ts" },
  { id: "checkout", label: "Checkout", kind: "Service", x: 52, y: 20, file: "services/checkout/src/index.ts" },
  { id: "orders", label: "Orders", kind: "Service", x: 52, y: 66, file: "services/orders/src/create.ts" },
  { id: "stripe", label: "Stripe API", kind: "External", x: 78, y: 12, file: "services/checkout/src/payment.ts" },
  { id: "database", label: "Orders DB", kind: "Postgres", x: 78, y: 62, file: "infra/docker-compose.yml" },
  { id: "email", label: "Email", kind: "Worker", x: 78, y: 82, file: "workers/email/src/consumer.ts" },
];

const journeySteps = ["Open store", "Add item", "View cart", "Submit payment", "Create order", "Confirmation"];

function Logo() {
  return <span className="logo-mark" aria-hidden="true"><i /><i /><i /></span>;
}

export default function Home() {
  const [view, setView] = useState<ProductView>("landing");
  const [setupStep, setSetupStep] = useState(0);
  const [scenario, setScenario] = useState<ScenarioKey>("payments");
  const [phase, setPhase] = useState<RunPhase>("ready");
  const [selectedNode, setSelectedNode] = useState("checkout");
  const [elapsed, setElapsed] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [showPr, setShowPr] = useState(false);
  const [showScenarioBuilder, setShowScenarioBuilder] = useState(false);
  const [showModelEditor, setShowModelEditor] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [projectName, setProjectName] = useState("Checkout resilience");
  const [recordStatus, setRecordStatus] = useState("Workspace record ready");
  const activeRunId = useRef<string | null>(null);
  const [nodeNames, setNodeNames] = useState<Record<string, string>>(() => Object.fromEntries(nodes.map((node) => [node.id, node.label])));
  const data = scenarios[scenario];

  const graphState = phase === "ready" ? "healthy" : phase === "verified" || phase === "repaired" ? "repaired" : "failed";
  const activeMetrics = phase === "verified" || phase === "repaired" ? data.after : data.baseline;

  useEffect(() => {
    if (phase !== "running") return;
    const ticker = window.setInterval(() => setElapsed((n) => Math.min(n + 5, 45)), 115);
    const done = window.setTimeout(() => setPhase("failed"), 1200);
    return () => { window.clearInterval(ticker); window.clearTimeout(done); };
  }, [phase]);

  const persistRun = async () => {
    if (activeRunId.current) return activeRunId.current;
    setRecordStatus("Saving immutable run…");
    const response = await fetch("/api/saas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create-run", scenario }) });
    const payload = await response.json() as { run?: { id?: string }; error?: string };
    if (!response.ok || !payload.run?.id) throw new Error(payload.error || "Unable to save this run");
    activeRunId.current = payload.run.id;
    setRecordStatus("Run saved to workspace");
    return payload.run.id;
  };
  const runScenario = () => {
    activeRunId.current = null;
    setElapsed(0);
    setPhase("running");
    void persistRun().catch((error) => setRecordStatus(error instanceof Error ? error.message : "Run record unavailable"));
  };
  const startRepair = () => {
    setPhase("repairing");
    window.setTimeout(() => setPhase("repaired"), 1400);
  };
  const verify = () => {
    setElapsed(0);
    setPhase("running");
    window.setTimeout(() => {
      setPhase("verified");
      void persistRun().then(async (runId) => {
        setRecordStatus("Verifying workspace evidence…");
        const response = await fetch("/api/saas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verify-run", runId }) });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Unable to verify this run");
        setRecordStatus("Verified evidence saved");
      }).catch((error) => setRecordStatus(error instanceof Error ? error.message : "Verification record unavailable"));
    }, 1250);
  };

  const selected = useMemo(() => {
    const node = nodes.find((n) => n.id === selectedNode)!;
    return { ...node, label: nodeNames[node.id] ?? node.label };
  }, [selectedNode, nodeNames]);
  const isBroken = (id: string) => graphState === "failed" && ["checkout", "orders", scenario === "payments" ? "stripe" : scenario === "database" ? "database" : "gateway"].includes(id);

  const downloadReport = () => {
    const report = `WORLDMODEL VERIFICATION REPORT\n\nProject: shopstream/demo-store\nBase commit: d4f9a81\nScenario: ${data.label} (${data.detail})\nScenario ID: scn_checkout_20x_8f31\nSeed: worldmodel-2026-0713\nEnvironment: env_a42 · 2 CPU · 1 GB · outbound network blocked\n\nROOT CAUSE\nConfirmed: unbounded synchronous payment calls held checkout workers until timeout, propagating saturation to order creation and the checkout journey. Evidence: trace tr_8f31, payment.ts:2–8, Playwright step 4.\n\nVERIFIED REPAIR\nAdded a 1.5s timeout, circuit breaker, idempotency key, and durable payment-retry queue. Changed services/checkout/src/payment.ts and tests/checkout.spec.mjs.\n\nBEFORE → AFTER\nResilience: ${data.baseline.score} → ${data.after.score}\nError rate: ${data.baseline.errors} → ${data.after.errors}\nP95 latency: ${data.baseline.latency} → ${data.after.latency}\nJourney success: ${data.baseline.journey} → ${data.after.journey}\nRecovery: 74s → 9s\n\nEVIDENCE\n✓ Identical scenario fingerprint 6c3f9c31a2d0\n✓ 6/6 Playwright journey steps passed\n✓ 9/9 platform and integration checks passed\n✓ 12 orders checked; zero duplicate orders\n✓ Secret scan and dependency audit passed\n\nREMAINING RISKS\n• Regional provider failure was not tested.\n• Queue saturation beyond 20× traffic remains unverified.\n• Manual review of payment reconciliation is recommended.\n\nROLLBACK\nRevert commit candidate-b17 and drain payment-retry before disabling the worker.\n\nDraft PR: feat/resilient-checkout (preview #248)\nGenerated by WorldModel for Software`;
    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "worldmodel-verification-report.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (view === "landing") return (
    <main className="landing-shell">
      <header className="landing-nav"><div className="brand"><Logo /><span>WorldModel</span><b>ALPHA</b></div><div><button onClick={() => setView("twin")}>View demo twin</button><button onClick={() => window.location.assign("/dashboard")}>Open workspace</button><button className="primary" data-testid="start-simulation" onClick={() => setView("setup")}>Start a simulation</button></div></header>
      <section className="hero-copy"><span>AI-ASSISTED RESILIENCE ENGINEERING</span><h1>Break your software<br/>before your users do.</h1><p>Create a living model of your application, simulate production failures, and let Codex build and verify repairs in a safe virtual environment.</p><div><button className="hero-primary" onClick={() => setView("setup")}>Start a simulation <b>→</b></button><button className="hero-secondary" onClick={() => setView("twin")}>▶ Watch the 20-second demo</button></div><small><i /> Prepared TypeScript repository · No production credentials required</small></section>
      <section className="hero-visual" aria-label="Failure to repair preview"><div className="hero-stage"><span>01 · HEALTHY MODEL</span><div className="mini-graph healthy-mini"><i>Store</i><b>API</b><em>Pay</em></div></div><div className="hero-arrow">→</div><div className="hero-stage failed-stage"><span>02 · FAILURE SPREADS</span><div className="mini-graph"><i>Store</i><b>API</b><em>Pay</em></div><small>Checkout success 22%</small></div><div className="hero-arrow">→</div><div className="hero-stage repaired-stage"><span>03 · CODEX VERIFIED</span><div className="mini-graph healthy-mini"><i>Store</i><b>API</b><em>Pay</em></div><small>Checkout success 100%</small></div></section>
      <footer className="hero-proof"><div><strong>7</strong><span>services mapped</span></div><div><strong>3</strong><span>repeatable scenarios</span></div><div><strong>6/6</strong><span>journey steps</span></div><div><strong>6c3f…a2d0</strong><span>immutable replay</span></div></footer>
    </main>
  );

  if (view === "setup") {
    const setupSteps = ["Create project", "Connect repository", "Review model", "Launch environment", "Validate baseline"];
    return <main className="setup-shell">
      <header className="setup-header"><div className="brand"><Logo /><span>WorldModel</span></div><span>New software twin</span><button onClick={() => setView("landing")}>Exit setup</button></header>
      <div className="setup-layout">
        <aside><span className="eyebrow">PROJECT SETUP</span><ol>{setupSteps.map((label,index)=><li key={label} className={setupStep === index ? "active" : setupStep > index ? "done" : ""}><i>{setupStep > index ? "✓" : index + 1}</i><span><b>{label}</b><small>{index === 0 ? "Name and objective" : index === 1 ? "Least-privilege read" : index === 2 ? "Evidence and confidence" : index === 3 ? "Disposable sandbox" : "Prove healthy state"}</small></span></li>)}</ol><div className="safety-note"><b>Safe by default</b><p>Only the prepared sample repository runs. Production secrets and outbound access stay blocked.</p></div></aside>
        <section className="setup-card" data-testid={`setup-step-${setupStep}`}>
          {setupStep === 0 && <><span className="setup-index">01 / 05</span><h1>Create a software twin</h1><p>Tell WorldModel what matters. You can adjust every detected component before anything runs.</p><label>Project name<input value={projectName} onChange={(e)=>setProjectName(e.target.value)} /></label><label>Reliability goal<textarea defaultValue="Stress test checkout when the payment provider is unavailable." /></label><div className="suggestion-row"><button>Stress test checkout</button><button>Test a pull request</button><button>Model an outage</button></div><button className="setup-next" data-testid="continue-project" onClick={()=>setSetupStep(1)}>Continue <span>→</span></button></>}
          {setupStep === 1 && <><span className="setup-index">02 / 05</span><h1>Select a repository</h1><p>For this controlled demonstration, WorldModel uses a trusted TypeScript commerce application with no production credentials.</p><button className="repo-option selected"><span className="github-mark">⌘</span><div><b>shopstream / demo-store</b><small>TypeScript monorepo · updated 4m ago</small></div><em>SELECTED</em></button><div className="repo-config"><label>Branch<select defaultValue="main"><option>main</option><option>feature/new-checkout</option></select></label><label>Commit<input value="d4f9a81" readOnly /></label><label>Access<input value="Repository contents: read-only" readOnly /></label></div><div className="setup-actions"><button onClick={()=>setSetupStep(0)}>Back</button><button className="setup-next" data-testid="scan-repository" onClick={()=>setSetupStep(2)}>Scan repository <span>→</span></button></div></>}
          {setupStep === 2 && <><span className="setup-index">03 / 05</span><div className="scan-summary"><div><h1>Model ready for review</h1><p>42 files analyzed in 1.8s. Every relationship links to repository evidence.</p></div><strong>94<small>% confidence</small></strong></div><div className="detected-strip"><span><b>TypeScript</b><small>language</small></span><span><b>npm</b><small>packages</small></span><span><b>7</b><small>components</small></span><span><b>6</b><small>dependencies</small></span><span><b>1</b><small>journey</small></span></div><div className="review-list">{nodes.map((node)=><div key={node.id}><i>◇</i><input aria-label={`${node.label} name`} value={nodeNames[node.id]} onChange={(e)=>setNodeNames({...nodeNames,[node.id]:e.target.value})}/><span>{node.kind}</span><code>{node.file}</code><em>✓ VERIFIED</em></div>)}</div><p className="review-hint">Names and component types are editable. Verified means at least two independent repository signals agree.</p><div className="setup-actions"><button onClick={()=>setSetupStep(1)}>Back</button><button className="setup-next" data-testid="confirm-model" onClick={()=>setSetupStep(3)}>Confirm model <span>→</span></button></div></>}
          {setupStep === 3 && <><span className="setup-index">04 / 05</span><h1>Choose an environment</h1><p>A disposable environment lets WorldModel inject failures and verify repairs without touching production.</p><div className="environment-options"><button><span>QUICK MODEL</span><b>Architecture only</b><small>Estimated propagation · lower confidence</small></button><button className="selected"><span>RECOMMENDED</span><b>Virtual test environment</b><small>Real journey, telemetry, repair, and replay</small><em>✓</em></button></div><div className="environment-spec"><div><span>Build</span><code>npm ci && npm run build</code><b>✓</b></div><div><span>Start</span><code>docker compose up --wait</code><b>✓</b></div><div><span>Seed</span><code>npm run db:seed</code><b>✓</b></div><div><span>Limits</span><code>2 CPU · 1 GB · 5 min · network denied</code><b>✓</b></div><div><span>Mocks</span><code>Stripe · Postmark</code><b>✓</b></div></div><div className="setup-actions"><button onClick={()=>setSetupStep(2)}>Back</button><button className="setup-next" data-testid="launch-environment" onClick={()=>setSetupStep(4)}>Launch environment <span>→</span></button></div></>}
          {setupStep === 4 && <><span className="setup-index">05 / 05</span><h1>Healthy baseline confirmed</h1><p>The simulation is unlocked only because the application passed every preflight check from a clean seed.</p><div className="baseline-score"><div>✓</div><span><b>7 of 7 services healthy</b><small>Environment env_a42 · snapshot base_24</small></span><strong>READY</strong></div><div className="baseline-checks"><span><i>✓</i>Frontend loaded <b>182ms</b></span><span><i>✓</i>API health check <b>41ms</b></span><span><i>✓</i>PostgreSQL ready <b>12ms</b></span><span><i>✓</i>Checkout journey <b>6/6</b></span><span><i>✓</i>Light load test <b>0.2% errors</b></span><span><i>✓</i>Order integrity <b>0 duplicates</b></span></div><div className="baseline-metrics"><span><small>P95 LATENCY</small><b>342ms</b></span><span><small>ERROR RATE</small><b>0.2%</b></span><span><small>JOURNEY SUCCESS</small><b>100%</b></span></div><div className="setup-actions"><button onClick={()=>setSetupStep(3)}>Back</button><button className="setup-next" data-testid="enter-twin" onClick={()=>setView("twin")}>Open software twin <span>→</span></button></div></>}
        </section>
      </div>
    </main>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><Logo /><span>WorldModel</span><b>ALPHA</b></div>
        <nav aria-label="Primary navigation"><button className="active">Twin</button><button onClick={()=>{setView("setup");setSetupStep(0)}}>Project</button><button onClick={()=>setShowReport(true)}>Reports</button></nav>
        <div className="repo-chip"><span className="repo-glyph">⌘</span><div><b>shopstream / demo-store</b><small>main · connected</small></div><span className="live-dot" /></div>
      </header>

      <section className="commandbar">
        <div>
          <span className="eyebrow">SOFTWARE TWIN</span>
          <h1>Checkout resilience <span>v24</span></h1>
        </div>
        <div className="command-actions">
          <span className="environment"><i /> {recordStatus}</span>
          <button className="secondary" onClick={() => { activeRunId.current = null; setRecordStatus("Workspace record ready"); setPhase("ready"); setScenario("payments"); }}>Reset demo</button>
          <button className="primary" data-testid="run-simulation" onClick={runScenario} disabled={phase === "running" || phase === "repairing"}>{phase === "running" ? "Running…" : "Run simulation"}<span>▶</span></button>
        </div>
      </section>

      <section className="metric-strip" aria-label="Run metrics">
        <div><span>RESILIENCE SCORE</span><strong className={graphState === "failed" ? "bad" : graphState === "repaired" ? "good" : ""}>{phase === "ready" ? "96" : activeMetrics.score}<small>/100</small></strong><em>{graphState === "failed" ? "−65 under fault" : phase === "verified" ? "+63 verified" : phase === "repaired" ? "candidate ready" : "healthy baseline"}</em></div>
        <div><span>ERROR RATE</span><strong>{phase === "ready" ? "0.2%" : activeMetrics.errors}</strong><em>{graphState === "failed" ? "threshold 2%" : "within threshold"}</em></div>
        <div><span>P95 LATENCY</span><strong>{phase === "ready" ? "342ms" : activeMetrics.latency}</strong><em>{graphState === "failed" ? "SLO 800ms" : "SLO passed"}</em></div>
        <div><span>JOURNEY SUCCESS</span><strong>{phase === "ready" ? "100%" : activeMetrics.journey}</strong><em>{graphState === "failed" ? "checkout blocked" : "6 of 6 steps"}</em></div>
        <div><span>SERVICES</span><strong>{graphState === "failed" ? "4 / 7" : "7 / 7"}</strong><em>{graphState === "failed" ? "3 degraded" : "all healthy"}</em></div>
      </section>

      <div className="workspace-grid">
        <aside className="scenario-panel panel">
          <div className="panel-heading"><span>SCENARIOS</span><button aria-label="Add scenario" onClick={()=>setShowScenarioBuilder(true)}>＋</button></div>
          <div className="scenario-list">
            {(Object.keys(scenarios) as ScenarioKey[]).map((key) => (
              <button key={key} className={scenario === key ? "selected" : ""} onClick={() => { activeRunId.current = null; setRecordStatus("Workspace record ready"); setScenario(key); setPhase("ready"); }}>
                <i className={`scenario-icon ${key}`}>{key === "traffic" ? "↗" : key === "database" ? "▤" : "⚡"}</i>
                <span><b>{scenarios[key].label}</b><small>{scenarios[key].detail}</small></span>
                {scenario === key && <em>READY</em>}
              </button>
            ))}
          </div>
          <div className="immutable-card"><span>IMMUTABLE RUN SPEC</span><dl><div><dt>Scenario ID</dt><dd>scn_…8f31</dd></div><div><dt>Seed</dt><dd>wm-0713</dd></div><div><dt>Environment</dt><dd>env_a42</dd></div></dl><p>Every candidate replays this exact specification.</p></div>
          <div className="journey-mini"><span>CRITICAL JOURNEY</span><b>🛒 Complete checkout</b><div className="step-dots">{journeySteps.map((s, i) => <i key={s} className={graphState === "failed" && i > 2 ? "failed" : ""} title={s}>{i + 1}</i>)}</div><small>Playwright · 6 steps · SLO 2.0s</small></div>
        </aside>

        <section className="twin-panel panel" aria-label="Interactive system graph">
          <div className="canvas-head"><div><span className="eyebrow">LIVE SYSTEM MODEL</span><b>{phase === "ready" ? "Healthy baseline" : phase === "running" ? "Simulation in progress" : graphState === "failed" ? "Failure propagation detected" : phase === "verified" ? "Repair verified" : "Repair candidate ready"}</b></div><div className="canvas-tools"><button onClick={()=>setShowModelEditor(true)}>Edit model</button><div className="legend"><span><i className="healthy" />Healthy</span><span><i className="degraded" />Degraded</span><span><i className="failed" />Failed</span></div></div></div>
          <div className={`graph ${graphState}`}>
            <div className="grid-lines" />
            <div className="edge e1"/><div className="edge e2"/><div className="edge e3"/><div className="edge e4"/><div className="edge e5"/><div className="edge e6"/>
            {nodes.map((node) => (
              <button key={node.id} data-testid={`node-${node.id}`} onClick={() => setSelectedNode(node.id)} className={`graph-node ${selectedNode === node.id ? "focused" : ""} ${isBroken(node.id) ? node.id === (scenario === "payments" ? "stripe" : scenario === "database" ? "database" : "gateway") ? "failed" : "degraded" : "healthy"}`} style={{ left: `${node.x}%`, top: `${node.y}%` }}>
                <i>{node.kind === "External" ? "↗" : node.kind === "Postgres" ? "▤" : node.kind === "Worker" ? "✦" : "◇"}</i><span><b>{nodeNames[node.id]}</b><small>{node.kind}</small></span><em />
              </button>
            ))}
            {graphState === "failed" && <div className="impact-callout"><span>!</span><div><b>Propagation path found</b><small>{data.target} → Checkout → Orders → Customer</small></div></div>}
          </div>
          <div className="inspector" data-testid="node-inspector"><div><span>SELECTED NODE</span><b>{selected.label}</b></div><dl><div><dt>Health</dt><dd className={isBroken(selected.id) ? "danger" : "success"}>● {isBroken(selected.id) ? "Degraded" : "Healthy"}</dd></div><div><dt>P95</dt><dd>{isBroken(selected.id) ? activeMetrics.latency : "184ms"}</dd></div><div><dt>Volume</dt><dd>1,248 rpm</dd></div><div><dt>Confidence</dt><dd className="success">✓ Verified</dd></div><div><dt>Evidence</dt><dd title={selected.file}>{selected.file}</dd></div></dl></div>
        </section>

        <aside className="activity-panel panel">
          <div className="panel-heading"><span>RUN TIMELINE</span><b>{phase === "ready" ? "IDLE" : phase === "verified" ? "VERIFIED" : "LIVE"}</b></div>
          <div className="run-clock"><strong>00:{String(phase === "running" ? elapsed : phase === "ready" ? 0 : 45).padStart(2, "0")}</strong><span>/ 02:00</span><div><i style={{ width: `${phase === "running" ? Math.max(elapsed * 2.2, 8) : phase === "ready" ? 0 : 42}%` }} /></div></div>
          <ol className="timeline">
            <li className={phase !== "ready" ? "done" : "active"}><time>00:00</time><div><b>Baseline captured</b><small>7 services healthy · 342ms p95</small></div></li>
            <li className={phase === "ready" ? "future" : phase === "running" ? "active" : "danger"}><time>00:15</time><div><b>{data.event}</b><small>Target: {data.target}</small></div></li>
            <li className={["failed","repairing","repaired","verified"].includes(phase) ? "danger" : "future"}><time>00:21</time><div><b>Checkout SLO breached</b><small>{data.baseline.errors} errors · {data.baseline.latency} p95</small></div></li>
            <li className={["repaired","verified"].includes(phase) ? "done" : "future"}><time>00:45</time><div><b>{phase === "verified" ? "Replay passed" : "Fault window complete"}</b><small>{phase === "verified" ? "All assertions verified" : "System recovering"}</small></div></li>
          </ol>

          {phase === "failed" && <div className="action-card danger-card"><span>FAILURE CONFIRMED</span><h3>Checkout collapses when the payment dependency stops responding.</h3><p>Worker saturation propagates to Orders. 78% of customers cannot complete checkout.</p><button data-testid="investigate-repair" onClick={startRepair}>Investigate with Codex <span>→</span></button></div>}
          {phase === "repairing" && <div className="agent-card"><span className="agent-orb">✦</span><div><b>Codex is repairing the system</b><small>Tracing failure → editing payment.ts → running checks</small><div className="agent-progress"><i /></div></div></div>}
          {(phase === "repaired" || phase === "verified") && <div className="action-card winner-card"><span>✦ CODEX REPAIR · CANDIDATE B17</span><h3>Graceful payment fallback</h3><p>Timeout + circuit breaker + durable retry queue. 2 files changed, +48 −6.</p><div className="patch-tags"><i>payment.ts</i><i>checkout.spec.mjs</i></div><button className="diff-trigger" data-testid="view-code-diff" onClick={()=>setShowDiff(true)}>View code & test diff <span>+48 −6</span></button>{phase === "repaired" ? <button data-testid="replay-scenario" onClick={verify}>Replay identical scenario <span>▶</span></button> : <button data-testid="view-report" onClick={() => setShowReport(true)}>View verified report <span>→</span></button>}</div>}
        </aside>
      </div>

      {phase === "verified" && <section className="verified-banner" data-testid="verified-result"><div className="verified-icon">✓</div><div><span>IDENTICAL REPLAY PASSED</span><h2>Checkout survives the failure.</h2><p>Same scenario <b>scn_checkout_20x_8f31</b> · same seed · clean environment</p></div><div className="before-after"><div><span>BEFORE</span><b>{data.baseline.errors}</b><small>error rate</small></div><em>→</em><div><span>AFTER</span><b>{data.after.errors}</b><small>error rate</small></div></div><button onClick={() => setShowReport(true)}>Open report</button><button className="pr-button" onClick={() => setShowPr(true)}>Create draft PR</button></section>}

      {showReport && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setShowReport(false)}><section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title"><button className="modal-close" aria-label="Close report" onClick={() => setShowReport(false)}>×</button><div className="report-brand"><Logo /><span>WORLDMODEL / VERIFICATION</span><b>VERIFIED</b></div><h2 id="report-title">Checkout resilience report</h2><p className="report-sub">Evidence from immutable replay 6c3f9c31a2d0 · July 13, 2026</p><div className="report-score"><span>RESILIENCE SCORE</span><strong>{data.baseline.score}</strong><em>→</em><strong>{data.after.score}</strong><b>+{data.after.score - data.baseline.score}</b></div><div className="comparison-grid"><div><span>ERROR RATE</span><del>{data.baseline.errors}</del><strong>{data.after.errors}</strong></div><div><span>P95 LATENCY</span><del>{data.baseline.latency}</del><strong>{data.after.latency}</strong></div><div><span>JOURNEY SUCCESS</span><del>{data.baseline.journey}</del><strong>{data.after.journey}</strong></div></div><h3>What changed</h3><p>Codex added a 1.5s timeout, a circuit breaker, idempotent order handling, and a durable retry queue so checkout can safely accept an order while the payment provider recovers.</p><ul><li><b>6/6</b> Playwright journey steps passed</li><li><b>9/9</b> platform and integration checks passed</li><li><b>0</b> duplicate or lost orders</li></ul><div className="risk-box"><b>Remaining risks</b><p>Regional provider failure and queue saturation beyond 20× remain unverified. Manual payment reconciliation review is recommended.</p></div><div className="report-actions"><button onClick={downloadReport}>↓ Download report</button><button className="primary" onClick={() => { setShowReport(false); setShowPr(true); }}>Create draft PR →</button></div></section></div>}

      {showPr && <div className="modal-backdrop" role="presentation"><section className="pr-modal" role="dialog" aria-modal="true" aria-labelledby="pr-title"><button className="modal-close" aria-label="Close pull request" onClick={() => setShowPr(false)}>×</button><span className="github-mark">⌘</span><div className="draft-pill">DRAFT</div><h2 id="pr-title">feat: make checkout resilient to payment outages</h2><p>Prepared on <b>worldmodel/resilient-checkout</b> with the verified patch, scenario results, and rollback guidance attached.</p><div className="pr-checks"><span>✓ Simulation replay</span><span>✓ Playwright journey</span><span>✓ 9 checks</span></div><div className="pr-link"><span>shopstream/demo-store</span><b>#248</b></div><button className="primary" onClick={() => setShowPr(false)}>Draft PR ready <span>✓</span></button><small>Demo artifact — connect GitHub to publish this draft.</small></section></div>}

      {showScenarioBuilder && <div className="modal-backdrop"><section className="builder-modal" role="dialog" aria-modal="true" aria-labelledby="builder-title"><button className="modal-close" aria-label="Close scenario builder" onClick={()=>setShowScenarioBuilder(false)}>×</button><span className="setup-index">SCENARIO COPILOT</span><h2 id="builder-title">Describe a dangerous condition</h2><p>WorldModel will translate your request into reviewable, bounded settings. Nothing runs until you confirm.</p><textarea defaultValue="Increase traffic by twenty times and make the payment provider unavailable for 45 seconds."/><div className="interpretation"><span>STRUCTURED INTERPRETATION</span><dl><div><dt>Traffic</dt><dd>Ramp 1× → 20× over 15s</dd></div><div><dt>Fault</dt><dd>Stripe API returns HTTP 503</dd></div><div><dt>Window</dt><dd>00:15 → 01:00</dd></div><div><dt>Journey</dt><dd>Complete checkout · every 2s</dd></div><div><dt>Pass gate</dt><dd>≥95% success · P95 &lt;800ms</dd></div><div><dt>Safety</dt><dd>2 CPU · 1 GB · no outbound network</dd></div></dl></div><div className="report-actions"><button onClick={()=>setShowScenarioBuilder(false)}>Cancel</button><button className="primary" data-testid="confirm-scenario" onClick={()=>{setScenario("payments");setPhase("ready");setShowScenarioBuilder(false)}}>Confirm scenario →</button></div></section></div>}

      {showModelEditor && <div className="modal-backdrop"><section className="model-modal" role="dialog" aria-modal="true" aria-labelledby="model-title"><button className="modal-close" aria-label="Close model editor" onClick={()=>setShowModelEditor(false)}>×</button><span className="setup-index">MODEL VERSION 24</span><h2 id="model-title">Review detected components</h2><p>Rename services or correct the inferred type. Approved overrides survive the next scan.</p><div>{nodes.map(node=><label key={node.id}><input value={nodeNames[node.id]} onChange={(e)=>setNodeNames({...nodeNames,[node.id]:e.target.value})}/><select defaultValue={node.kind}><option>{node.kind}</option><option>Service</option><option>External</option><option>Worker</option><option>Database</option></select><span>✓ Verified</span></label>)}</div><div className="report-actions"><button onClick={()=>setShowModelEditor(false)}>Discard</button><button className="primary" data-testid="save-model" onClick={()=>setShowModelEditor(false)}>Save model →</button></div></section></div>}

      {showDiff && <div className="modal-backdrop"><section className="diff-modal" role="dialog" aria-modal="true" aria-labelledby="diff-title"><button className="modal-close" aria-label="Close code diff" onClick={()=>setShowDiff(false)}>×</button><div className="diff-head"><div><span>CODEX CANDIDATE B17</span><h2 id="diff-title">Graceful payment fallback</h2></div><b>2 files · +48 −6</b></div><div className="diff-tabs"><button className="active">payment.ts</button><button>checkout.spec.mjs <span>NEW TEST</span></button></div><pre><code><i>-  const response = await fetch(PAYMENT_URL, request);</i>{"\n"}<b>+  const controller = new AbortController();</b>{"\n"}<b>+  const timeout = setTimeout(() =&gt; controller.abort(), 1500);</b>{"\n"}<b>+  const response = await fetch(PAYMENT_URL, {"{"}</b>{"\n"}<b>+    ...request, signal: controller.signal,</b>{"\n"}<b>+    headers: {"{"} ...request.headers,</b>{"\n"}<b>+      &quot;idempotency-key&quot;: orderId {"}"}</b>{"\n"}<b>+  {"}"});</b>{"\n"}<b>+  if (!response.ok) return paymentRetryQueue.enqueue(order);</b></code></pre><div className="diff-evidence"><span><b>✓ New regression test</b><small>returns payment_pending without duplicate order</small></span><span><b>✓ Existing suite</b><small>9/9 checks pass</small></span><span><b>⚠ Residual risk</b><small>queue saturation beyond 20× untested</small></span></div><div className="report-actions"><button onClick={()=>setShowDiff(false)}>Close</button><button className="primary" onClick={()=>setShowDiff(false)}>Accept candidate →</button></div></section></div>}
    </main>
  );
}
