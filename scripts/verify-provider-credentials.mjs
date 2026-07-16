import fs from "node:fs";

const values = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const [composioResponse, openaiResponse] = await Promise.all([
  fetch(`https://backend.composio.dev/api/v3.1/auth_configs/${encodeURIComponent(values.COMPOSIO_GITHUB_AUTH_CONFIG_ID)}`, {
    headers: { accept: "application/json", "x-api-key": values.COMPOSIO_API_KEY },
  }),
  fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { accept: "application/json", authorization: `Bearer ${values.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: values.OPENAI_AGENT_MODEL, input: "Reply exactly OK.", reasoning: { effort: "none" }, max_output_tokens: 16, store: false }),
  }),
]);

const [composio, openai] = await Promise.all([
  composioResponse.json().catch(() => ({})),
  openaiResponse.json().catch(() => ({})),
]);
const result = {
  composio: {
    ok: composioResponse.ok,
    status: composioResponse.status,
    authConfigId: composio.auth_config?.id || composio.id || values.COMPOSIO_GITHUB_AUTH_CONFIG_ID,
    toolkit: composio.toolkit?.slug || composio.toolkit_slug || null,
    scheme: composio.auth_config?.auth_scheme || composio.auth_scheme || null,
  },
  openai: {
    ok: openaiResponse.ok,
    status: openaiResponse.status,
    model: openai.model || values.OPENAI_AGENT_MODEL,
    responseId: openai.id || null,
    errorType: openai.error?.type || null,
  },
};
console.log(JSON.stringify(result, null, 2));
if (!composioResponse.ok || !openaiResponse.ok) process.exit(1);
