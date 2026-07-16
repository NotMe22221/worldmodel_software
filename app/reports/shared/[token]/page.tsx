"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

export default function SharedReportPage() {
  const token = String(useParams<{ token: string }>().token || ""); const [payload, setPayload] = useState<Record<string, unknown> | null>(null); const [error, setError] = useState("");
  useEffect(() => { let active = true; void fetch(`/api/v1/shared-reports/${encodeURIComponent(token)}`).then(async (response) => { const body = await response.json() as Record<string, unknown> & { error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message || "Report unavailable"); if (active) setPayload(body); }).catch((reason) => active && setError(reason.message)); return () => { active = false; }; }, [token]);
  const report = (payload?.report || {}) as Record<string, unknown>;
  return <main style={{maxWidth:960,margin:"48px auto",padding:24,fontFamily:"Arial,sans-serif",color:"#17231d"}}><Link href="/" style={{color:"#237a51",textDecoration:"none"}}>WorldModel</Link><p style={{fontSize:11,letterSpacing:2,color:"#38835e",marginTop:38}}>READ-ONLY VERIFICATION REPORT</p>{error ? <h1>{error}</h1> : !payload ? <h1>Loading verified evidence...</h1> : <><h1 style={{fontSize:42,letterSpacing:-2}}>{String(report.decision)}</h1><section style={{border:"1px solid #d5dfd9",borderRadius:10,padding:24}}><h2>Root cause</h2><p>{String(report.rootCause)}</p><h2>Immutable replay</h2><p><b>Commit:</b> <code>{String(report.commitSha)}</code></p><p><b>Scenario:</b> <code>{String(report.scenarioFingerprint)}</code></p><p><b>Seed:</b> <code>{String(report.seed)}</code></p><h2>Residual risks</h2><ul>{(report.residualRisks as string[] || []).map((risk) => <li key={risk}>{risk}</li>)}</ul><h2>Rollback</h2><p>{String(report.rollback)}</p></section><p style={{fontSize:12,color:"#718078"}}>This private link is evidence-only. It cannot approve, publish, merge, or deploy changes.</p></>}</main>;
}
