"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import "../auth.css";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error || "Sign in failed"); setWorking(false); return; }
    const target = new URLSearchParams(location.search).get("returnTo");
    location.assign(target?.startsWith("/") && !target.startsWith("//") ? target : "/dashboard");
  }
  return <main className="auth-shell"><Link className="auth-brand" href="/"><i>W</i><b>WorldModel</b></Link><section className="auth-card"><span>WELCOME BACK</span><h1>Sign in to your workspace</h1><p>Access your repositories, environments, campaigns, and verification evidence.</p>{error && <div className="auth-error" role="alert">{error}</div>}<form onSubmit={submit}><label>Business email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" minLength={10} required /></label><button disabled={working}>{working ? "Signing in…" : "Sign in →"}</button></form><small>New to WorldModel? <Link href="/signup">Create an account</Link></small></section></main>;
}
