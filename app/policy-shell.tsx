import type { ReactNode } from "react";
import Link from "next/link";
import "./policy.css";

export function PolicyShell({ eyebrow, title, summary, children }: { eyebrow: string; title: string; summary: string; children: ReactNode }) {
  return <main className="policy-shell"><header><Link href="/" className="policy-brand"><i/><span>WorldModel</span></Link><nav><Link href="/trust">Trust center</Link><Link href="/security">Security</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/dashboard" className="policy-cta">Open workspace</Link></nav></header><section className="policy-hero"><span>{eyebrow}</span><h1>{title}</h1><p>{summary}</p><small>Last updated July 13, 2026 · Pre-commercial pilot</small></section><article className="policy-content">{children}</article><footer><span>WorldModel for Software</span><nav><Link href="/support">Support</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav></footer></main>;
}

export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return <section><h2>{title}</h2>{children}</section>;
}
