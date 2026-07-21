# Repository agent instructions

After completing a code-changing task:

1. Run the checks relevant to the files changed and fix any failures caused by the task.
2. Review the diff and commit only the task's scoped changes. Never commit `.env*`, credentials, generated secrets, or unrelated user work.
3. Push the current branch to `origin` after the commit succeeds. Never force-push. If authentication, branch protection, merge conflicts, or a detached checkout prevents a safe push, report the blocker instead of bypassing it.

Read-only investigations and tasks that produce no repository changes do not require a commit or push.
