"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import "./invite.css";

type Invitation = { workspaceName: string; role: string; expiresAt: string };
type InvitationResult = { error?: string; invitation: Invitation };

export default function InvitePage() {
  const token = useRef("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(location.search).get("token") || "";
    token.current = value;
    if (!value) { Promise.resolve().then(() => setError("This invitation link is incomplete.")); return; }
    fetch(`/api/invitations/accept?token=${encodeURIComponent(value)}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          const returnTo = `/invite?token=${encodeURIComponent(value)}`;
          location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
          return null;
        }
        const result = await response.json() as InvitationResult;
        if (!response.ok) throw new Error(result.error || "Invitation unavailable");
        return result.invitation;
      })
      .then((result) => { if (result) setInvitation(result); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Invitation unavailable"));
  }, []);

  async function accept() {
    setAccepting(true); setError("");
    try {
      const response = await fetch("/api/invitations/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: token.current }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Invitation could not be accepted");
      setAccepted(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Invitation could not be accepted"); }
    finally { setAccepting(false); }
  }

  return <main className="invite-page">
    <section className="invite-card">
      <Link className="invite-brand" href="/">◈ <b>WorldModel</b></Link>
      {accepted ? <><span className="invite-state success">ACCEPTED</span><h1>You’re in.</h1><p>Your active workspace has been changed. WorldModel will apply your assigned permissions everywhere.</p><Link className="invite-primary" href="/dashboard">Open workspace →</Link></> : invitation ? <><span className="invite-state">WORKSPACE INVITATION</span><h1>Join {invitation.workspaceName}</h1><p>You were invited as <strong>{invitation.role}</strong>. This link is bound to your signed-in email and expires {new Date(invitation.expiresAt).toLocaleString()}.</p><dl><div><dt>Workspace</dt><dd>{invitation.workspaceName}</dd></div><div><dt>Role</dt><dd>{invitation.role}</dd></div></dl>{error && <p className="invite-error" role="alert">{error}</p>}<button className="invite-primary" disabled={accepting} onClick={accept}>{accepting ? "Accepting…" : "Accept invitation →"}</button><small>Only accept if you recognize this workspace and expected the invitation.</small></> : <><span className="invite-state">CHECKING INVITATION</span><h1>{error ? "Invitation unavailable" : "Verifying your access…"}</h1><p role={error ? "alert" : undefined}>{error || "Confirming the signed-in identity, expiration, and one-time token."}</p>{error && <Link className="invite-primary" href="/dashboard">Return to dashboard</Link>}</>}
    </section>
  </main>;
}
