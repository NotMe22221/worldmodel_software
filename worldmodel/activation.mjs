export function buildWorkspaceActivation({
  workspaceMode,
  projects = [],
  runs = [],
  members = [],
  invitations = [],
}) {
  if (workspaceMode !== "customer") return null;
  const verifiedProjects = projects.filter((project) =>
    Boolean(project.repository_verified),
  );
  const verifiedProjectIds = new Set(
    verifiedProjects.map((project) => project.id),
  );
  const ownedRuns = runs.filter((run) => verifiedProjectIds.has(run.project_id));
  const steps = [
    {
      key: "repository",
      label: "Connect a repository",
      complete: verifiedProjects.length > 0,
      completedAt:
        verifiedProjects.at(-1)?.created_at || null,
    },
    {
      key: "simulation",
      label: "Run the first failure simulation",
      complete: ownedRuns.length > 0,
      completedAt: ownedRuns.at(-1)?.created_at || null,
    },
    {
      key: "verification",
      label: "Submit observed replay evidence",
      complete: ownedRuns.some(
        (run) => run.status === "verified" && run.evidence_kind === "observed",
      ),
      completedAt:
        ownedRuns.find(
          (run) => run.status === "verified" && run.evidence_kind === "observed",
        )?.verified_at || null,
    },
    {
      key: "team",
      label: "Invite a teammate",
      complete: members.length > 1 || invitations.length > 0,
      completedAt:
        members.at(1)?.created_at || invitations.at(-1)?.created_at || null,
    },
  ];
  const completed = steps.filter((step) => step.complete).length;
  return {
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    steps,
  };
}
