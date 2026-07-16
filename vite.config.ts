import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
  durable_objects: {
    bindings: [{ name: "RUN_EVENTS", class_name: "RunEventHub" }, { name: "Sandbox", class_name: "Sandbox" }],
  },
  migrations: [{ tag: "worldmodel-v1", new_sqlite_classes: ["RunEventHub"] }, { tag: "sandbox-v1", new_sqlite_classes: ["Sandbox"] }],
  containers: [{ class_name: "Sandbox", image: "./Dockerfile.worldmodel", instance_type: "standard-1", max_instances: 20 }],
  services: [{ binding: "SCAN_RUNNER", service: "worldmodel-for-software", entrypoint: "NativeSandboxRunner" }, { binding: "SANDBOX_RUNNER", service: "worldmodel-for-software", entrypoint: "NativeSandboxRunner" }],
  workflows: [
    { name: "worldmodel-scan", binding: "WORLDMODEL_SCAN", class_name: "WorldModelScanWorkflow" },
    { name: "worldmodel-campaign", binding: "WORLDMODEL_CAMPAIGN", class_name: "WorldModelCampaignWorkflow" },
    { name: "worldmodel-repair", binding: "WORLDMODEL_REPAIR", class_name: "WorldModelRepairWorkflow" },
  ],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig as never,
      }),
    ],
  };
});
