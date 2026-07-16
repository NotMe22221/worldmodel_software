"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import "../auth.css";

export default function SignupPage() {
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); setError("");
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirmation")) { setError("Passwords do not match"); setWorking(false); return; }
    try {
      const response = await fetch("/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: form.get("displayName"), organizationName: form.get("organizationName"), email: form.get("email"), password: form.get("password") }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "We could not create your workspace. Try again.");
      location.assign("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not create your workspace. Try again.");
      setWorking(false);
    }
  }
  return <main className="auth-shell"><Link className="auth-brand" href="/"><i>W</i><b>WorldModel</b></Link><section className="auth-card wide"><span>START YOUR WORKSPACE</span><h1>Create your workspace</h1><p>Begin with a private, empty workspace. Only repositories and evidence your team explicitly adds will appear here.</p>{error && <div className="auth-error" role="alert">{error}</div>}<form onSubmit={submit} aria-busy={working}><div className="auth-grid"><label>Your name<input name="displayName" autoComplete="name" minLength={2} required /></label><label>Organization<input name="organizationName" autoComplete="organization" minLength={2} required /></label></div><label>Business email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="new-password" minLength={10} required /><small>Use at least 10 characters</small></label><label>Confirm password<input name="confirmation" type="password" autoComplete="new-password" minLength={10} required /></label><button type="submit" disabled={working}>{working ? "Creating workspace…" : "Create workspace →"}</button></form><small>Already have an account? <Link href="/login">Sign in</Link></small></section></main>;
}
