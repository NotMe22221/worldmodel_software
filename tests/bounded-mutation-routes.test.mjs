import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = [
  { file: "../app/api/api-keys/route.ts", limit: "MAX_API_KEY_BODY_BYTES", bytes: "8_192", message: "8 KB" },
  { file: "../app/api/billing/checkout/route.ts", limit: "MAX_CHECKOUT_BODY_BYTES", bytes: "2_048", message: "2 KB" },
  { file: "../app/api/data/deletion/route.ts", limit: "MAX_DELETION_BODY_BYTES", bytes: "4_096", message: "4 KB" },
  { file: "../app/api/integrations/composio/github/repositories/route.ts", limit: "MAX_COMPOSIO_ACTION_BODY_BYTES", bytes: "8_192", message: "8 KB", nestedError: true },
  { file: "../app/api/invitations/accept/route.ts", limit: "MAX_INVITATION_BODY_BYTES", bytes: "2_048", message: "2 KB" },
  { file: "../app/api/operator/route.ts", limit: "MAX_OPERATOR_BODY_BYTES", bytes: "8_192", message: "8 KB" },
  { file: "../app/api/provider-settings/route.ts", limit: "MAX_PROVIDER_SETTINGS_BODY_BYTES", bytes: "65_536", message: "64 KB" },
  { file: "../app/api/readiness/route.ts", limit: "MAX_READINESS_BODY_BYTES", bytes: "4_096", message: "4 KB" },
  { file: "../app/api/repairs/route.ts", limit: "MAX_REPAIR_BODY_BYTES", bytes: "16_384", message: "16 KB" },
  { file: "../app/api/saas/route.ts", limit: "MAX_SAAS_BODY_BYTES", bytes: "16_384", message: "16 KB" },
  { file: "../app/api/support/route.ts", limit: "MAX_SUPPORT_BODY_BYTES", bytes: "16_384", message: "16 KB" },
  { file: "../app/api/team/route.ts", limit: "MAX_TEAM_BODY_BYTES", bytes: "8_192", message: "8 KB" },
];

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("production JSON mutation routes use explicit bounded-reader contracts", async () => {
  for (const route of routes) {
    const source = await readFile(new URL(route.file, import.meta.url), "utf8");
    assert.match(source, new RegExp(`const ${route.limit} = ${route.bytes};`), route.file);
    assert.match(source, new RegExp(`readBoundedRequestJson(?:<[^>]+>)?\\(request, ${route.limit}\\)`), route.file);
    assert.match(source, /error instanceof RequestBodyTooLargeError/, route.file);
    assert.match(source, /status: tooLarge \? 413 :/, route.file);
    assert.match(source, new RegExp(`Request body exceeds ${escaped(route.message)}`), route.file);
    assert.doesNotMatch(source, /request\.json\(/, route.file);
  }
});

test("Composio mutation size failures retain the structured provider error envelope", async () => {
  const route = routes.find((candidate) => candidate.nestedError);
  assert.ok(route);
  const source = await readFile(new URL(route.file, import.meta.url), "utf8");
  assert.match(source, /code: tooLarge \? "REQUEST_TOO_LARGE" : "INVALID_JSON"/);
  assert.match(source, /retriable: false, correlationId/);
});
