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
    const response = await fetch("/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: form.get("displayName"), organizationName: form.get("organizationName"), email: form.get("email"), password: form.get("password") }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error || "Account creation failed"); setWorking(false); return; }
    location.assign("/dashboard");
  }
  return <main className="auth-shell"><Link className="auth-brand" href="/"><i>W</i><b>WorldModel</b></Link><section className="auth-card wide"><span>START YOUR WORKSPACE</span><h1>Create a real customer account</h1><p>No prepared data. Your workspace begins empty and only contains repositories and evidence your team creates.</p>{error && <div className="auth-error" role="alert">{error}</div>}<form onSubmit={submit}><div className="auth-grid"><label>Your name<input name="displayName" autoComplete="name" minLength={2} required /></label><label>Organization<input name="organizationName" autoComplete="organization" minLength={2} required /></label></div><label>Business email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="new-password" minLength={10} required /><small>At least 10 characters</small></label><label>Confirm password<input name="confirmation" type="password" autoComplete="new-password" minLength={10} required /></label><button disabled={working}>{working ? "Creating workspace…" : "Create workspace →"}</button></form><small>Already have an account? <Link href="/login">Sign in</Link></small></section></main>;
}
