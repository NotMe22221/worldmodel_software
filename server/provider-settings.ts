import { getRuntimeEnv, isLocalDevelopmentEnvironment } from "./runtime-env.ts";

export type ProviderInput = { composioApiKey?: string; composioGithubAuthConfigId?: string; githubAppSlug?: string; githubAppId?: string; githubClientId?: string; githubClientSecret?: string; githubPrivateKey?: string; openaiApiKey?: string; openaiModel?: string };

export type ProviderSettingsMode = {
  editable: boolean;
  source: "local_encrypted_store" | "deployment_environment";
};

export function providerSettingsModeForEnvironment(env: Record<string, unknown>): ProviderSettingsMode {
  const editable = isLocalDevelopmentEnvironment(env);
  return {
    editable,
    source: editable ? "local_encrypted_store" : "deployment_environment",
  };
}

export async function providerSettingsMode() {
  return providerSettingsModeForEnvironment(await getRuntimeEnv());
}

async function key(secret: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)); return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]); }
function encode(value: Uint8Array) { return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join("")); }
function decode(value: string) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
async function encrypt(value: Record<string, string>, secret: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), new TextEncoder().encode(JSON.stringify(value))); return JSON.stringify({ iv: encode(iv), data: encode(new Uint8Array(ciphertext)) }); }
async function decrypt(value: string, secret: string) { const payload = JSON.parse(value) as { iv: string; data: string }; const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(payload.iv) }, await key(secret), decode(payload.data)); return JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, string>; }

async function context() {
  const env = await getRuntimeEnv();
  if (!providerSettingsModeForEnvironment(env).editable) throw new Error("Provider credentials must be configured as deployment environment variables outside local development");
  if (!env.DB) throw new Error("Provider settings storage is unavailable");
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS local_provider_settings (id TEXT PRIMARY KEY, encrypted_json TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  return { db: env.DB, secret: String(env.WORLDMODEL_LOCAL_SETTINGS_KEY || "worldmodel-local-provider-settings-v1") };
}

export async function loadLocalProviderSettings() { try { const { db, secret } = await context(); const row = await db.prepare("SELECT encrypted_json FROM local_provider_settings WHERE id = 'providers'").first<{ encrypted_json: string }>(); return row ? await decrypt(row.encrypted_json, secret) : {}; } catch { return {}; } }

export async function saveLocalProviderSettings(email: string, input: ProviderInput) {
  const current = await loadLocalProviderSettings();
  const values = {
    ...current,
    COMPOSIO_API_KEY: input.composioApiKey?.trim() || current.COMPOSIO_API_KEY || "",
    COMPOSIO_GITHUB_AUTH_CONFIG_ID: input.composioGithubAuthConfigId?.trim() || current.COMPOSIO_GITHUB_AUTH_CONFIG_ID || "",
    GITHUB_APP_SLUG: input.githubAppSlug?.trim() || current.GITHUB_APP_SLUG || "",
    GITHUB_APP_ID: input.githubAppId?.trim() || current.GITHUB_APP_ID || "",
    GITHUB_CLIENT_ID: input.githubClientId?.trim() || current.GITHUB_CLIENT_ID || "",
    GITHUB_CLIENT_SECRET: input.githubClientSecret?.trim() || current.GITHUB_CLIENT_SECRET || "",
    GITHUB_APP_PRIVATE_KEY: input.githubPrivateKey?.trim().replaceAll("\\n", "\n") || current.GITHUB_APP_PRIVATE_KEY || "",
    OPENAI_API_KEY: input.openaiApiKey?.trim() || current.OPENAI_API_KEY || "",
    OPENAI_AGENT_MODEL: input.openaiModel?.trim() || current.OPENAI_AGENT_MODEL || "gpt-5.6",
  };
  const hasComposio = Boolean(values.COMPOSIO_API_KEY);
  const githubValues = [values.GITHUB_APP_SLUG, values.GITHUB_APP_ID, values.GITHUB_CLIENT_ID, values.GITHUB_CLIENT_SECRET, values.GITHUB_APP_PRIVATE_KEY];
  const hasGithubApp = githubValues.every(Boolean);
  if (!hasComposio && !hasGithubApp) throw new Error("Add a Composio project API key");
  if (values.COMPOSIO_API_KEY && !/^ak_[A-Za-z0-9_-]{8,}$/.test(values.COMPOSIO_API_KEY) && values.COMPOSIO_API_KEY !== "fixture") throw new Error("Composio API key format is invalid");
  if (values.COMPOSIO_GITHUB_AUTH_CONFIG_ID && !/^[A-Za-z0-9_-]{3,160}$/.test(values.COMPOSIO_GITHUB_AUTH_CONFIG_ID)) throw new Error("Composio GitHub auth config ID is invalid");
  if (githubValues.some(Boolean) && !hasGithubApp) throw new Error("Complete every custom GitHub App field or leave all of them empty");
  if (hasGithubApp && !/^[a-z0-9-]{2,100}$/i.test(values.GITHUB_APP_SLUG)) throw new Error("Enter the GitHub App slug shown in the app URL");
  if (hasGithubApp && !/^\d+$/.test(values.GITHUB_APP_ID)) throw new Error("GitHub App ID must be numeric");
  if (hasGithubApp && (!values.GITHUB_APP_PRIVATE_KEY.includes("BEGIN") || !values.GITHUB_APP_PRIVATE_KEY.includes("PRIVATE KEY"))) throw new Error("Paste the complete GitHub App private key PEM");
  const { db, secret } = await context();
  await db.prepare("INSERT INTO local_provider_settings (id, encrypted_json, updated_by, updated_at) VALUES ('providers', ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET encrypted_json=excluded.encrypted_json, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP").bind(await encrypt(values, secret), email).run();
  return { saved: true };
}
