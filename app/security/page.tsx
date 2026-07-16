import { PolicySection, PolicyShell } from "../policy-shell";

export default function SecurityPage() {
  return (
    <PolicyShell
      eyebrow="SECURITY"
      title="Secure defaults, reviewable evidence."
      summary="This page describes safeguards implemented in the current product—not certifications or controls that are merely planned."
    >
      <PolicySection title="Access and tenant isolation">
        <ul>
          <li>
            Private deployment access and signed-in identity are provided by the
            hosting platform.
          </li>
          <li>
            Every workspace mutation performs a server-side membership and role
            check.
          </li>
          <li>
            Cross-tenant operations require an explicit server-side operator
            email allowlist. The operator console provides no customer
            impersonation or secret access.
          </li>
          <li>
            Project, run, report, integration, support, and audit queries are
            scoped to the current workspace.
          </li>
          <li>
            Viewers cannot create projects, run simulations, change settings, or
            invite members.
          </li>
        </ul>
      </PolicySection>
      <PolicySection title="Team invitations">
        <ul>
          <li>
            Invitation links use high-entropy random material; only a SHA-256
            digest is stored.
          </li>
          <li>
            Links are bound to the invited email, expire after seven days, and
            can be accepted only once.
          </li>
          <li>
            Pending invitations reserve plan seats and can be revoked
            immediately by an authorized administrator.
          </li>
          <li>
            Owner and administrator boundaries are enforced server-side for
            invitations, role changes, and removals, with durable rate limiting
            and audit events.
          </li>
        </ul>
      </PolicySection>
      <PolicySection title="Automation credentials">
        <ul>
          <li>
            Developer API keys are generated from high-entropy random material
            and only the SHA-256 digest is stored.
          </li>
          <li>
            The full credential is displayed once; it cannot be recovered later.
          </li>
          <li>
            Keys have explicit project-read, run-read, and run-write scopes,
            optional expiry, immediate revocation, and a durable per-minute
            request limit.
          </li>
          <li>
            API requests remain tenant-scoped and create audit events for
            simulation changes.
          </li>
        </ul>
      </PolicySection>
      <PolicySection title="Provider integrations">
        <ul>
          <li>
            GitHub connections use a hosted Composio OAuth link plus one-time,
            expiring tenant-bound state. The callback accepts only the expected
            GitHub auth configuration and WorldModel user identity.
          </li>
          <li>
            Repository operations use the scoped Composio connected account.
            WorldModel does not ask for or store long-lived GitHub user tokens.
          </li>
          <li>
            Draft publication requires an approved repair and a second explicit
            action; it writes only the bounded tenant-owned evidence packet and
            never merges the pull request.
          </li>
          <li>
            Stripe collects payment details on Stripe-hosted Checkout.
            WorldModel does not receive card numbers.
          </li>
          <li>
            Billing management uses short-lived Stripe-hosted portal sessions
            created only for an authenticated owner or administrator linked to
            the workspace customer record.
          </li>
          <li>
            Subscription changes require a fresh matching Stripe raw-body
            webhook signature and event IDs are processed idempotently.
          </li>
        </ul>
      </PolicySection>
      <PolicySection title="Simulation and change safety">
        <ul>
          <li>
            The prepared virtual environment blocks outbound network access and
            uses external-service mocks.
          </li>
          <li>
            Failure scenarios preserve fingerprints and seeds for identical
            replay.
          </li>
          <li>
            Repairs remain candidates until an owner or administrator records a
            review decision; pull-request handoff is blocked until approval.
          </li>
          <li>Material actions create append-only tenant audit events.</li>
        </ul>
      </PolicySection>
      <PolicySection title="Current limitations">
        <p>
          WorldModel has not completed an independent penetration test, SOC 2
          audit, formal business-continuity exercise, or published
          vulnerability-response SLA. The pilot should not be used to store
          secrets or regulated data. External CI access also requires an
          API-capable production ingress; the current Sites deployment remains
          private. Report security concerns through the authenticated support
          workflow.
        </p>
      </PolicySection>
    </PolicyShell>
  );
}
