"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import "./report.css";

export default function SharedReportPage() {
  const token = String(useParams<{ token: string }>().token || "");
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/shared-reports/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const body = await response.json() as Record<string, unknown> & { error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message || "This report is unavailable");
        if (active) setPayload(body);
      })
      .catch((reason: Error) => active && setError(reason.message));
    return () => { active = false; };
  }, [token]);

  const report = (payload?.report || {}) as Record<string, unknown>;
  const risks = report.residualRisks as string[] || [];

  return <main className="shared-report-shell">
    <header className="shared-report-nav">
      <Link href="/"><i aria-hidden="true">W</i><span>WorldModel</span></Link>
      <b>READ-ONLY EVIDENCE</b>
    </header>

    {error ? <section className="shared-report-state"><span>REPORT UNAVAILABLE</span><h1>{error}</h1><p>Confirm that the private link is complete and has not expired.</p></section>
      : !payload ? <section className="shared-report-state"><span>VERIFICATION REPORT</span><h1>Loading evidence…</h1><p>Retrieving the signed, read-only report.</p></section>
      : <>
        <section className="shared-report-hero">
          <div><span>VERIFICATION DECISION</span><h1>{String(report.decision)}</h1><p>Evidence from an immutable replay, prepared for engineering review.</p></div>
          <aside><span>ACCESS</span><b>Private link</b><small>View only</small></aside>
        </section>

        <section className="shared-report-card">
          <article className="shared-report-summary"><span>ROOT CAUSE</span><h2>What failed</h2><p>{String(report.rootCause)}</p></article>
          <article className="shared-report-evidence"><span>IMMUTABLE REPLAY</span><h2>Evidence identity</h2><dl>
            <div><dt>Commit</dt><dd><code>{String(report.commitSha)}</code></dd></div>
            <div><dt>Scenario</dt><dd><code>{String(report.scenarioFingerprint)}</code></dd></div>
            <div><dt>Seed</dt><dd><code>{String(report.seed)}</code></dd></div>
          </dl></article>
          <div className="shared-report-grid">
            <article><span>RESIDUAL RISK</span><h2>What remains</h2>{risks.length ? <ul>{risks.map((risk) => <li key={risk}>{risk}</li>)}</ul> : <p>No residual risks were recorded.</p>}</article>
            <article><span>ROLLBACK</span><h2>Recovery plan</h2><p>{String(report.rollback)}</p></article>
          </div>
        </section>

        <footer className="shared-report-footer"><b>Evidence boundary</b><p>This link can display evidence. It cannot approve, publish, merge, or deploy changes.</p></footer>
      </>}
  </main>;
}
