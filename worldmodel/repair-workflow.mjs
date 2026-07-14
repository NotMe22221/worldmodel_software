const transitions = Object.freeze({
  "ready_for_review:request-review": "in_review",
  "changes_requested:request-review": "in_review",
  "in_review:approve": "approved",
  "in_review:request-changes": "changes_requested",
  "approved:prepare-pr": "pr_ready",
});

export function repairTransition(status, action) {
  const next = transitions[`${status}:${action}`];
  if (!next)
    throw new Error(`Repair transition ${status} → ${action} is not allowed`);
  return next;
}

export function repairCanTransition(status, action) {
  return Boolean(transitions[`${status}:${action}`]);
}
