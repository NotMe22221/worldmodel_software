import Link from "next/link";

function Mark() {
  return <span className="warm-mark" aria-hidden="true"><i /><i /><i /></span>;
}

function Arrow() {
  return <span aria-hidden="true">→</span>;
}

export default function Home() {
  return <main className="warm-landing">
    <div className="warm-orbit warm-orbit-left" aria-hidden="true" />
    <div className="warm-orbit warm-orbit-right" aria-hidden="true" />

    <header className="warm-nav">
      <Link className="warm-brand" href="/" aria-label="WorldModel home"><Mark /><strong>WorldModel</strong><span>for Software</span></Link>
      <nav aria-label="Main navigation">
        <a href="#platform">Product <small>⌄</small></a>
        <a href="#workflow">How it works</a>
        <Link href="/trust">Docs</Link>
        <a href="#security">Security</a>
        <Link href="/support">Resources <small>⌄</small></Link>
      </nav>
      <div className="warm-nav-actions"><Link href="/login">Log in</Link><Link className="warm-button" href="/signup">Get started</Link></div>
    </header>

    <section className="warm-hero">
      <div className="warm-hero-copy">
        <span className="warm-kicker">VERIFIED RELIABILITY ENGINEERING</span>
        <h1>Prove your<br />software is <em>ready</em><br />for what’s next.</h1>
        <p>Model your production system, rehearse high-impact failures, and verify every repair against the same evidence—before you ship.</p>
        <div className="warm-hero-actions"><Link className="warm-button warm-button-large" href="/signup">Start free <Arrow /></Link><Link className="warm-button-quiet" href="/trust"><span aria-hidden="true">▣</span> Read docs</Link></div>
        <ul className="warm-proof-list" aria-label="Product assurances"><li><i>✓</i>Private by default</li><li><i>♙</i>Human-approved changes</li><li><i>⌘</i>Evidence-backed results</li></ul>
      </div>

      <div className="warm-system-map" aria-label="Illustration of a software system recovering from a simulated failure">
        <div className="map-wash wash-lilac" /><div className="map-wash wash-blue" /><div className="map-wash wash-coral" /><div className="map-wash wash-mint" /><div className="map-wash wash-yellow" />
        <svg className="map-connections" viewBox="0 0 620 500" preserveAspectRatio="none" aria-hidden="true">
          <path className="line-blue" d="M290 80 C290 132 285 142 286 188 C288 235 350 230 370 277" />
          <path className="line-blue" d="M184 190 C240 190 230 223 284 223 C338 223 338 188 397 188" />
          <path className="line-mint" d="M155 218 C155 265 150 273 150 312" />
          <path className="line-mint dash" d="M150 338 C180 367 220 360 264 368 C307 376 315 348 358 340" />
          <path className="line-purple" d="M286 224 C286 290 322 285 370 315" />
          <path className="line-yellow" d="M432 216 C436 259 438 262 423 300" />
          <path className="line-coral dash" d="M474 184 C540 196 526 258 520 302 C510 345 477 350 450 344" />
          <path className="line-blue" d="M152 346 C152 405 258 390 292 425" />
          <path className="line-mint" d="M335 443 C392 444 409 404 410 365" />
        </svg>
        <div className="map-live-chip">⌁ Live traffic</div>
        <article className="map-node node-store"><i>▤</i><span><b>Storefront</b><small>Web application</small></span><em>⌁⌁⌁</em></article>
        <article className="map-node node-api"><i>‹/›</i><span><b>API Gateway</b><small>Edge service</small></span><u /></article>
        <article className="map-node node-pay"><i>▣</i><span><b>Payment Service</b><small>Core dependency</small></span><u className="failed" /><strong>!</strong></article>
        <article className="map-node node-worker"><i>✿</i><span><b>Worker</b><small>Background jobs</small></span><u /></article>
        <article className="map-node node-agent"><i>✦</i><span><b>AI Repair Agent</b><small>Evidence-bound</small></span></article>
        <article className="map-node node-db"><i>▱</i><span><b>Database</b><small>PostgreSQL</small></span><u /></article>
        <div className="map-error-chip">▲ Error spike</div><div className="map-repair-chip">✦ Proposes fix</div><div className="map-recovered-chip">Recovered</div>

        <aside className="warm-proof-card">
          <span>Checkout success</span>
          <div><small>Before</small><b className="metric-bad">82.1%</b><i>↓</i><small>After</small><b className="metric-good">97.3%</b></div>
          <hr />
          <span>Error rate (5xx)</span>
          <div><small>Before</small><b className="metric-bad">5.6%</b><i>↓</i><small>After</small><b className="metric-good">0.7%</b></div>
          <p><i>◷</i><span>MTTR improved<br /><b>from 47m to 6m</b></span></p>
        </aside>
      </div>
    </section>

    <section className="warm-step-grid" id="platform">
      <article><header><i>1</i><div><b>Map the real system</b><span>Connect a repository and review every inferred service and dependency.</span></div></header><div className="mini-scene mini-topology"><span>◎</span><span>‹/›</span><span>▱</span><span>▣</span><span>⚙</span><svg viewBox="0 0 260 120" aria-hidden="true"><path d="M44 32 H110 L155 24 M110 32 L92 92 M155 24 V80 H213" /></svg></div><footer>⌘ Topology and contracts</footer></article>
      <article><header><i>2</i><div><b>Rehearse critical failures</b><span>Run bounded scenarios that mirror the incidents your team plans for.</span></div></header><div className="mini-scene mini-faults"><div><p>› Latency spike</p><p>› DB connection drops</p><p>› Payment gateway timeout</p><p>› Queue backlog</p></div><i>!</i></div><footer>ϟ Controlled fault library</footer></article>
      <article><header><i>3</i><div><b>Compare verified repairs</b><span>Evaluate candidate fixes against identical replay evidence and hard gates.</span></div></header><div className="mini-scene mini-repair"><div><i /><i /><i /><i /></div><span>Approve fix&nbsp; ✓</span></div><footer>✦ Evidence-based comparison</footer></article>
      <article><header><i>4</i><div><b>Make the release decision</b><span>Approve the strongest result with a complete, auditable evidence trail.</span></div></header><div className="mini-scene mini-chart"><svg viewBox="0 0 260 120" aria-hidden="true"><path d="M8 102 C35 96 39 55 61 69 S91 87 111 45 S143 80 164 47 S195 65 211 31 S238 24 252 8" /><line x1="8" y1="102" x2="252" y2="102" /></svg><i>✓</i></div><footer>♢ Release confidence</footer></article>
    </section>

    <section className="warm-integrations" aria-label="Supported engineering tools"><span>BUILT FOR MODERN ENGINEERING TEAMS</span><div><b>◆ GitHub</b><b>▣ TypeScript</b><b>◎ Playwright</b><b>◯ Cloudflare</b><b>✦ OpenAI</b></div></section>

    <section className="warm-product-story" id="workflow">
      <div className="story-copy"><span className="warm-kicker">ONE CONTROL PLANE</span><h2>From repository to a verified reliability decision.</h2><p>Connect an exact commit, review the inferred system model, approve a bounded environment, and run up to 20 scenarios from one AI-assisted campaign.</p><ol><li><i>01</i><span><b>Observe the real system</b><small>Evidence-linked graph, routes, tests, services, and dependencies.</small></span></li><li><i>02</i><span><b>Run many bounded simulations</b><small>Traffic, dependency, database, and combined failure scenarios.</small></span></li><li><i>03</i><span><b>Compare three repairs</b><small>Identical replay, hard gates, deterministic scoring, human approval.</small></span></li></ol><Link className="warm-text-link" href="/signup">Create your workspace <Arrow /></Link></div>
      <div className="story-panel">
        <header><span>CAMPAIGN / CHECKOUT RESILIENCE</span><b>3 RUNNING · 17 QUEUED</b></header>
        <div className="campaign-bars"><span><b>Traffic surge</b><i><u style={{width:"84%"}} /></i><em>Running</em></span><span><b>Payment outage</b><i><u style={{width:"61%"}} /></i><em>Investigating</em></span><span><b>Database latency</b><i><u style={{width:"38%"}} /></i><em>Running</em></span></div>
        <div className="campaign-matrix"><span>Baseline <b>✓</b></span><span>Surge <b>✓</b></span><span>Outage <b>!</b></span><span>Latency <b>✓</b></span><span>Combined <b>…</b></span><span>Recovery <b>✓</b></span></div>
        <footer><div><span>Ordered events</span><b>1,284</b></div><div><span>Evidence artifacts</span><b>42</b></div><div><span>Estimated finish</span><b>8m</b></div></footer>
      </div>
    </section>

    <section className="warm-security" id="security">
      <div><span className="warm-kicker">SAFE BY CONSTRUCTION</span><h2>Agents propose.<br /><em>Workflows decide.</em></h2><p>Every sensitive action is tenant-scoped, persisted, validated, and explicitly approved.</p><Link className="warm-button-quiet" href="/security">Explore security <Arrow /></Link></div>
      <div className="security-cards"><article><i>⌘</i><span><b>Real authentication</b><small>Revocable HTTP-only sessions and protected application routes.</small></span></article><article><i>♙</i><span><b>Human approvals</b><small>Commands, campaigns, and repository writes are separately authorized.</small></span></article><article><i>◇</i><span><b>Tenant isolation</b><small>Projects, events, artifacts, reports, and quotas stay workspace-scoped.</small></span></article><article><i>✓</i><span><b>Evidence or nothing</b><small>No runner attestation means no result is labeled observed.</small></span></article></div>
    </section>

    <section className="warm-final-cta"><div className="map-wash wash-lilac" /><div className="map-wash wash-yellow" /><span>RELEASE DECISIONS, BACKED BY EVIDENCE</span><h2>Know what will happen<br />before production does.</h2><p>Start in a private workspace. Connect only the repositories and environments your team approves.</p><div><Link className="warm-button warm-button-large" href="/signup">Start free <Arrow /></Link><Link className="warm-button-quiet" href="/support">Talk to us</Link></div></section>

    <footer className="warm-footer"><div><Link className="warm-brand" href="/"><Mark /><strong>WorldModel</strong><span>for Software</span></Link><p>Evidence-backed reliability engineering for modern software teams.</p></div><nav><div><b>Product</b><a href="#platform">Platform</a><a href="#workflow">How it works</a><Link href="/security">Security</Link></div><div><b>Company</b><Link href="/trust">Trust center</Link><Link href="/support">Support</Link></div><div><b>Legal</b><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div></nav><small>© 2026 WorldModel. All rights reserved.</small></footer>
  </main>;
}
