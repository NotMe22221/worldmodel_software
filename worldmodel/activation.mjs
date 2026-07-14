export function buildWorkspaceActivation({
  workspaceMode,
  projects = [],
  runs = [],
  members = [],
  invitations = [],
}) {
  if (workspaceMode !== "customer") return null;
  const steps = [
    {
      key: "repository",
      label: "Connect a repository",
      complete: projects.length > 0,
      completedAt: projects.at(-1)?.created_at || null,
    },
    {
      key: "simulation",
      label: "Run the first failure simulation",
      complete: runs.length > 0,
      completedAt: runs.at(-1)?.created_at || null,
    },
    {
      key: "verification",
      label: "Verify an identical replay",
      complete: runs.some((run) => run.status === "verified"),
      completedAt:
        runs.find((run) => run.status === "verified")?.verified_at || null,
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
