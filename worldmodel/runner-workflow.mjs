export function generateRunnerWorkflow({ projectId, apiOrigin }) {
  if (!/^proj_[A-Za-z0-9_-]{3,100}$/.test(projectId || "")) throw new Error("Project ID is invalid");
  let origin;
  try { origin = new URL(apiOrigin); } catch { throw new Error("API origin is invalid"); }
  if (origin.origin !== apiOrigin || (origin.protocol !== "https:" && origin.hostname !== "localhost")) throw new Error("API origin is invalid");
  const audience = encodeURIComponent(`${origin.origin}/api/v1/runner/token`);
  return `name: WorldModel observed resilience run

on:
  workflow_dispatch:
    inputs:
      run_id:
        description: WorldModel campaign run ID
        required: true
        type: string

permissions:
  contents: read
  id-token: write

concurrency:
  group: worldmodel-observed-${projectId}
  cancel-in-progress: false

jobs:
  observe:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Run disposable environment and Playwright journey
        run: npm run worldmodel:observe
      - name: Validate evidence artifact exists
        run: test -s .worldmodel/observed-run.json
      - name: Exchange GitHub OIDC and submit observed evidence
        run: |
          OIDC_TOKEN=$(curl --fail-with-body --silent \\
            -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \\
            "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=${audience}" | jq -r .value)
          RUN_TOKEN=$(curl --fail-with-body --silent \\
            -X POST "${origin.origin}/api/v1/runner/token" \\
            -H "Authorization: Bearer $OIDC_TOKEN" \\
            -H "Content-Type: application/json" \\
            --data '{"projectId":"${projectId}","runId":"\${{ inputs.run_id }}"}' | jq -r .token)
          jq '. + {action:"observe", projectId:"${projectId}"}' .worldmodel/observed-run.json > /tmp/worldmodel-submit.json
          curl --fail-with-body --retry 2 --retry-all-errors \\
            -X POST "${origin.origin}/api/v1/runner/evidence" \\
            -H "Authorization: Bearer $RUN_TOKEN" \\
            -H "Content-Type: application/json" \\
            --data-binary @/tmp/worldmodel-submit.json
          rm -f /tmp/worldmodel-submit.json
`;
}
