"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import "../auth.css";
import { useSafeReturnPath } from "../use-safe-return";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const returnTo = useSafeReturnPath();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "We could not sign you in. Try again.");
      location.assign(returnTo);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not sign you in. Try again.");
      setWorking(false);
    }
  }
  return <main className="auth-shell"><Link className="auth-brand" href="/"><i>W</i><b>WorldModel</b></Link><section className="auth-card"><span>WELCOME BACK</span><h1>Sign in to your workspace</h1><p>Access your repositories, environments, campaigns, and verification evidence.</p>{error && <div className="auth-error" role="alert">{error}</div>}<form onSubmit={submit} aria-busy={working}><label>Business email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" minLength={10} required /></label><button type="submit" disabled={working}>{working ? "Signing in…" : "Sign in →"}</button></form><small>New to WorldModel? <Link href={`/signup?returnTo=${encodeURIComponent(returnTo)}`}>Create an account</Link></small></section></main>;
}
