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
            GitHub installations use one-time, expiring connection state and are
            accepted only after the authorizing GitHub user can access that
            installation.
          </li>
          <li>
            Repository operations use installation-scoped tokens. Long-lived
            GitHub user access tokens are not stored.
          </li>
          <li>
            Stripe collects payment details on Stripe-hosted Checkout.
            WorldModel does not receive card numbers.
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
          <li>Repairs remain candidates until a human reviews them.</li>
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
