export const DRAFT_PR_PUBLICATION_LEASE_MS = 10 * 60_000;

export function deterministicDraftPrBranch(reportId: string, artifactSha256: string) {
  if (!/^[a-f0-9]{64}$/i.test(artifactSha256)) {
    throw new Error("artifact_integrity_error: Candidate artifact digest is invalid");
  }
  const report = reportId
    .replace(/[^a-z0-9_-]/gi, "-")
    .toLowerCase()
    .slice(0, 100) || "report";
  return `worldmodel/${report}-${artifactSha256.toLowerCase().slice(0, 12)}`;
}

export function draftPrPublicationLeaseExpired(startedAt: string | null | undefined, now = Date.now()) {
  if (!startedAt) return true;
  const started = Date.parse(startedAt);
  return !Number.isFinite(started) || now - started >= DRAFT_PR_PUBLICATION_LEASE_MS;
}
