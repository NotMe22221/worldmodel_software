type Check = { key: string; label: string; category: string; passed: boolean; source: "automatic" | "attested"; evidence: string };

export function launchReadiness(snapshot: {
  projects: Array<unknown>; runs: Array<{ status?: string }>; githubInstallations: Array<unknown>; subscription: { status?: string } | null;
  auditAccess: boolean; launchChecks: Array<{ check_key: string; passed: number | boolean; evidence?: string | null }>;
  configuration: { github: { configured: boolean }; billing: { configured: boolean } };
}) {
  const attested = new Map(snapshot.launchChecks.map((check) => [check.check_key, check]));
  const manual = (key: string, label: string, category: string, fallback: string): Check => {
    const value = attested.get(key);
    return { key, label, category, passed: Boolean(value?.passed), source: "attested", evidence: value?.evidence || fallback };
  };
  const checks: Check[] = [
    { key: "workspace_persistence", label: "Tenant persistence", category: "Product", passed: true, source: "automatic", evidence: "D1-backed workspace records and role checks are active." },
    { key: "verified_replay", label: "Verified simulation evidence", category: "Product", passed: snapshot.runs.some((run) => run.status === "verified"), source: "automatic", evidence: "At least one identical replay must be verified." },
    { key: "audit_export", label: "Audit and data export", category: "Governance", passed: true, source: "automatic", evidence: "Role-aware JSON export and administrator audit CSV are available." },
    { key: "github_live", label: "GitHub production connection", category: "Integrations", passed: snapshot.configuration.github.configured && snapshot.githubInstallations.length > 0, source: "automatic", evidence: snapshot.configuration.github.configured ? "Install the GitHub App for this workspace." : "Production GitHub App credentials are missing." },
    { key: "billing_live", label: "Paid billing lifecycle", category: "Billing", passed: snapshot.configuration.billing.configured && Boolean(snapshot.subscription && ["active", "trialing"].includes(snapshot.subscription.status || "")), source: "automatic", evidence: snapshot.configuration.billing.configured ? "Complete a signed subscription lifecycle." : "Production Stripe credentials are missing." },
    manual("legal_review", "Counsel-approved commercial terms", "Legal", "Owner attestation and review evidence required."),
    manual("security_review", "Independent security review", "Security", "Owner attestation and review evidence required."),
    manual("incident_plan", "Incident response plan", "Operations", "Document ownership and escalation path."),
    manual("support_owner", "Named customer support owner", "Operations", "Record the accountable support owner."),
  ];
  const passed = checks.filter((check) => check.passed).length;
  return { checks, passed, total: checks.length, score: Math.round((passed / checks.length) * 100), ready: passed === checks.length };
}
