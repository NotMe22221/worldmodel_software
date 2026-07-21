export function generateRunnerWorkflow({ projectId, apiOrigin }) {
  if (!/^proj_[A-Za-z0-9_-]{3,100}$/.test(projectId || "")) throw new Error("Project ID is invalid");
  let origin;
  try { origin = new URL(apiOrigin); } catch { throw new Error("API origin is invalid"); }
  if (origin.origin !== apiOrigin || (origin.protocol !== "https:" && origin.hostname !== "localhost")) throw new Error("API origin is invalid");
  const audience = encodeURIComponent(`${origin.origin}/api/v1/runner/token`);
  return `# Install at .github/workflows/worldmodel-${projectId}.yml; the signed runner identity is bound to this exact path.
name: WorldModel observed resilience run

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
    timeout-minutes: 75
    steps:
      - name: Authorize immutable execution
        id: worldmodel
        env:
          WORLDMODEL_RUN_ID: \${{ inputs.run_id }}
        shell: bash
        run: |
          set -euo pipefail
          umask 077
          EXECUTION_SPEC="$RUNNER_TEMP/worldmodel-execution.json"
          TOKEN_RESPONSE="$RUNNER_TEMP/worldmodel-token-response.json"
          OIDC_TOKEN="$(curl --fail-with-body --silent --show-error \\
            -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \\
            "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=${audience}" | jq -er '.value | select(type == "string" and length > 0)')"
          jq -n \\
            --arg projectId "${projectId}" \\
            --arg runId "$WORLDMODEL_RUN_ID" \\
            '{projectId:$projectId,runId:$runId}' | \\
            curl --fail-with-body --silent --show-error \\
              -X POST "${origin.origin}/api/v1/runner/token" \\
              -H "Authorization: Bearer $OIDC_TOKEN" \\
              -H "Content-Type: application/json" \\
              --data-binary @- \\
              --output "$TOKEN_RESPONSE"
          jq -e \\
            --arg projectId "${projectId}" \\
            --arg runId "$WORLDMODEL_RUN_ID" \\
            --arg repository "$GITHUB_REPOSITORY" '
              .execution
              | (.projectId == $projectId)
                and (.runId == $runId)
                and ((.repository.fullName | ascii_downcase) == ($repository | ascii_downcase))
                and (.repository.branch | type == "string" and length > 0 and length <= 255)
                and (.scenario.evidenceMode == "observed")
                and (.scenario.cleanupPolicy == "always")
                and (.scenarioFingerprint | type == "string" and test("^[a-f0-9]{64}$"))
                and (.environment.backend == "github_actions")
                and (.environment.manifest.nodeVersion == "20" or .environment.manifest.nodeVersion == "22")
                and (.environment.manifest.packageManager == "npm" or .environment.manifest.packageManager == "pnpm" or .environment.manifest.packageManager == "yarn")
                and (.environment.manifest.install | type == "string" and length > 0)
                and (.environment.manifest.observeCommand | type == "string" and length > 0)
                and (.environment.manifest.resources.timeoutSeconds | type == "number" and . >= 30 and . <= 3600)
                and (.model.commitSha | type == "string" and test("^[a-f0-9]{40}$"))
            ' "$TOKEN_RESPONSE" >/dev/null
          jq -S '.execution' "$TOKEN_RESPONSE" > "$EXECUTION_SPEC"
          rm -f "$TOKEN_RESPONSE"
          {
            printf 'commit_sha=%s\\n' "$(jq -er '.model.commitSha' "$EXECUTION_SPEC")"
            printf 'node_version=%s\\n' "$(jq -er '.environment.manifest.nodeVersion' "$EXECUTION_SPEC")"
            printf 'package_manager=%s\\n' "$(jq -er '.environment.manifest.packageManager' "$EXECUTION_SPEC")"
          } >> "$GITHUB_OUTPUT"
      - uses: actions/checkout@v4
        with:
          ref: \${{ steps.worldmodel.outputs.commit_sha }}
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ steps.worldmodel.outputs.node_version }}
      - name: Install the approved dependency graph
        env:
          WORLDMODEL_EXECUTION_SPEC: \${{ runner.temp }}/worldmodel-execution.json
        shell: bash
        run: |
          set -euo pipefail
          PACKAGE_MANAGER="$(jq -er '.environment.manifest.packageManager' "$WORLDMODEL_EXECUTION_SPEC")"
          if [ "$PACKAGE_MANAGER" != "npm" ]; then corepack enable; fi
          INSTALL_COMMAND="$(jq -er '.environment.manifest.install' "$WORLDMODEL_EXECUTION_SPEC")"
          read -r -a INSTALL_PARTS <<< "$INSTALL_COMMAND"
          "\${INSTALL_PARTS[@]}"
      - name: Run disposable environment and Playwright journey
        env:
          WORLDMODEL_EXECUTION_SPEC: \${{ runner.temp }}/worldmodel-execution.json
        shell: bash
        run: |
          set -euo pipefail
          OBSERVE_COMMAND="$(jq -er '.environment.manifest.observeCommand' "$WORLDMODEL_EXECUTION_SPEC")"
          TIMEOUT_SECONDS="$(jq -er '.environment.manifest.resources.timeoutSeconds' "$WORLDMODEL_EXECUTION_SPEC")"
          read -r -a OBSERVE_PARTS <<< "$OBSERVE_COMMAND"
          timeout --signal=TERM --kill-after=30s "\${TIMEOUT_SECONDS}s" "\${OBSERVE_PARTS[@]}"
      - name: Validate bounded evidence artifact
        shell: bash
        run: |
          set -euo pipefail
          EVIDENCE_FILE=".worldmodel/observed-run.json"
          test -s "$EVIDENCE_FILE"
          test "$(wc -c < "$EVIDENCE_FILE")" -le 5000000
          jq -e '
            (.environment | type == "object")
            and (.environment.id | type == "string" and length > 0)
            and (.environment.destroyedAt | type == "string" and length > 0)
            and (.journey | type == "object")
            and (.journey.runner == "playwright")
            and (.before | type == "object")
            and (.after | type == "object")
          ' "$EVIDENCE_FILE" >/dev/null
      - name: Reauthorize and submit authoritative observed evidence
        env:
          WORLDMODEL_RUN_ID: \${{ inputs.run_id }}
          WORLDMODEL_EXECUTION_SPEC: \${{ runner.temp }}/worldmodel-execution.json
        shell: bash
        run: |
          set -euo pipefail
          umask 077
          TOKEN_RESPONSE="$RUNNER_TEMP/worldmodel-token-response.json"
          FRESH_EXECUTION="$RUNNER_TEMP/worldmodel-fresh-execution.json"
          SUBMIT_FILE="$RUNNER_TEMP/worldmodel-submit.json"
          SUBMIT_RESPONSE="$RUNNER_TEMP/worldmodel-submit-response.json"
          OIDC_TOKEN="$(curl --fail-with-body --silent --show-error \\
            -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \\
            "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=${audience}" | jq -er '.value | select(type == "string" and length > 0)')"
          jq -n \\
            --arg projectId "${projectId}" \\
            --arg runId "$WORLDMODEL_RUN_ID" \\
            '{projectId:$projectId,runId:$runId}' | \\
            curl --fail-with-body --silent --show-error \\
              -X POST "${origin.origin}/api/v1/runner/token" \\
              -H "Authorization: Bearer $OIDC_TOKEN" \\
              -H "Content-Type: application/json" \\
              --data-binary @- \\
              --output "$TOKEN_RESPONSE"
          RUN_TOKEN="$(jq -er '.token | select(type == "string" and length > 0)' "$TOKEN_RESPONSE")"
          jq -S '.execution' "$TOKEN_RESPONSE" > "$FRESH_EXECUTION"
          cmp --silent "$WORLDMODEL_EXECUTION_SPEC" "$FRESH_EXECUTION"
          jq --slurpfile execution "$WORLDMODEL_EXECUTION_SPEC" '
            . as $observed
            | $execution[0] as $execution
            | {
                action: "observe",
                projectId: $execution.projectId,
                scenarioFingerprint: $execution.scenarioFingerprint,
                seed: $execution.scenario.seed,
                environment: {
                  id: $observed.environment.id,
                  revisionId: $execution.environment.id,
                  destroyedAt: $observed.environment.destroyedAt
                },
                journey: $observed.journey,
                before: $observed.before,
                after: $observed.after
              }
          ' .worldmodel/observed-run.json > "$SUBMIT_FILE"
          test "$(wc -c < "$SUBMIT_FILE")" -le 5000000
          curl --fail-with-body --silent --show-error --retry 2 --retry-all-errors \\
            -X POST "${origin.origin}/api/v1/runner/evidence" \\
            -H "Authorization: Bearer $RUN_TOKEN" \\
            -H "Content-Type: application/json" \\
            --data-binary @"$SUBMIT_FILE" \\
            --output "$SUBMIT_RESPONSE"
          jq -e '.accepted == true' "$SUBMIT_RESPONSE" >/dev/null
          jq '{accepted, runId, simulationRunId, status, duplicate}' "$SUBMIT_RESPONSE"
          rm -f "$TOKEN_RESPONSE" "$FRESH_EXECUTION" "$SUBMIT_FILE" "$SUBMIT_RESPONSE"
      - name: Remove temporary authorization state
        if: always()
        shell: bash
        run: |
          rm -f \\
            "$RUNNER_TEMP/worldmodel-execution.json" \\
            "$RUNNER_TEMP/worldmodel-fresh-execution.json" \\
            "$RUNNER_TEMP/worldmodel-token-response.json" \\
            "$RUNNER_TEMP/worldmodel-submit.json" \\
            "$RUNNER_TEMP/worldmodel-submit-response.json"
`;
}
