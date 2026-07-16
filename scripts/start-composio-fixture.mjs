import { spawn } from "node:child_process";
import path from "node:path";

const port = process.argv[2] || "3110";
// Next's production server canonicalizes same-origin redirects to localhost.
// Pin the browser fixture to that exact host so its host-only session cookie is preserved.
const origin = `http://localhost:${port}`;
const child = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "start", "--hostname", "127.0.0.1", "--port", port], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    WORLDMODEL_LOCAL_RUNTIME: "true",
    WORLDMODEL_LOCAL_STATE_DIR: path.join(process.env.TEMP || "C:\\tmp", `worldmodel-composio-browser-${port}`),
    COMPOSIO_API_KEY: "fixture",
    COMPOSIO_GITHUB_AUTH_CONFIG_ID: "ac_fixture_github",
    COMPOSIO_API_BASE_URL: `${origin}/api/fixtures/composio/api/v3.1`,
    COMPOSIO_FIXTURE_MODE: "true",
    WORLDMODEL_PUBLIC_ORIGIN: origin,
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
