import { githubConfiguration } from "./runtime-config.ts";

const API_VERSION = "2026-03-10";

function base64Url(input: Uint8Array | string) {
  const binary = typeof input === "string" ? input : Array.from(input, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function pemBytes(pem: string) {
  const normalized = pem.replaceAll("\\n", "\n").replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function appJwt(appId: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(privateKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

async function githubFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": API_VERSION, "user-agent": "WorldModel-for-Software", ...init?.headers } });
  if (!response.ok) throw new Error(`GitHub request failed with status ${response.status}`);
  return response.json() as Promise<T>;
}

export async function exchangeGithubCode(code: string, redirectUri: string) {
  const config = await githubConfiguration();
  const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri }) });
  const payload = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error ? `GitHub authorization failed: ${payload.error}` : "GitHub authorization failed");
  return payload.access_token;
}

export type GithubInstallation = { id: number; account: { login: string; type: string }; repository_selection: string; permissions: Record<string, string> };

export async function accessibleInstallations(userToken: string) {
  const result = await githubFetch<{ installations: GithubInstallation[] }>("https://api.github.com/user/installations?per_page=100", userToken);
  return result.installations;
}

export function authorizedInstallation(installations: GithubInstallation[], installationId: string) {
  return installations.find((candidate) => String(candidate.id) === installationId) || null;
}

export async function installationToken(installationId: string) {
  const config = await githubConfiguration();
  const jwt = await appJwt(config.appId, config.privateKey);
  const result = await githubFetch<{ token: string }>(`https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`, jwt, { method: "POST" });
  return result.token;
}

export type GithubRepository = { id: number; full_name: string; default_branch: string; private: boolean };

export async function installationRepositories(installationId: string) {
  const token = await installationToken(installationId);
  const result = await githubFetch<{ repositories: GithubRepository[] }>("https://api.github.com/installation/repositories?per_page=100", token);
  return result.repositories;
}
