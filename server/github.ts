import { githubConfiguration } from "./runtime-config.ts";

const API_VERSION = "2026-03-10";
const GITHUB_REQUEST_TIMEOUT_MS = 20_000;

function isAbortFailure(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  return name === "AbortError" || name === "TimeoutError";
}

async function withGithubDeadline<T>(callerSignal: AbortSignal | null | undefined, operation: (signal: AbortSignal) => Promise<T>) {
  const timeoutSignal = AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  try {
    return await operation(signal);
  } catch (error) {
    if (timeoutSignal.aborted && (error === timeoutSignal.reason || isAbortFailure(error))) {
      throw new Error("GitHub request timed out");
    }
    throw error;
  }
}

function base64Url(input: Uint8Array | string) {
  const binary =
    typeof input === "string"
      ? input
      : Array.from(input, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function pemBytes(pem: string) {
  const normalized = pem
    .replaceAll("\\n", "\n")
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function appJwt(appId: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

async function githubFetch<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  return withGithubDeadline(init?.signal, async (signal) => {
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": API_VERSION,
        "user-agent": "WorldModel-for-Software",
        ...init?.headers,
      },
      signal,
    });
    if (!response.ok)
      throw new Error(`GitHub request failed with status ${response.status}`);
    return response.json() as Promise<T>;
  });
}

export async function exchangeGithubCode(code: string, redirectUri: string) {
  const config = await githubConfiguration();
  return withGithubDeadline(undefined, async (signal) => {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal,
    });
    const payload = (await response.json()) as {
      access_token?: string;
      error?: string;
    };
    if (!response.ok || !payload.access_token)
      throw new Error(
        payload.error
          ? `GitHub authorization failed: ${payload.error}`
          : "GitHub authorization failed",
      );
    return payload.access_token;
  });
}

export type GithubInstallation = {
  id: number;
  account: { login: string; type: string };
  repository_selection: string;
  permissions: Record<string, string>;
};

export async function accessibleInstallations(userToken: string) {
  const result = await githubFetch<{ installations: GithubInstallation[] }>(
    "https://api.github.com/user/installations?per_page=100",
    userToken,
  );
  return result.installations;
}

export function authorizedInstallation(
  installations: GithubInstallation[],
  installationId: string,
) {
  return (
    installations.find(
      (candidate) => String(candidate.id) === installationId,
    ) || null
  );
}

export async function installationToken(installationId: string) {
  const config = await githubConfiguration();
  const jwt = await appJwt(config.appId, config.privateKey);
  const result = await githubFetch<{ token: string }>(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    jwt,
    { method: "POST" },
  );
  return result.token;
}

export type GithubRepository = {
  id: number;
  full_name: string;
  default_branch: string;
  private: boolean;
};

export async function installationRepositories(installationId: string) {
  const token = await installationToken(installationId);
  const result = await githubFetch<{ repositories: GithubRepository[] }>(
    "https://api.github.com/installation/repositories?per_page=100",
    token,
  );
  return result.repositories;
}

export async function repositoryTree(
  installationId: string,
  fullName: string,
  branch: string,
) {
  const token = await installationToken(installationId);
  return repositoryTreeWithToken(fullName, branch, token);
}

export async function repositoryTreeWithToken(
  fullName: string,
  branch: string,
  token: string,
) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(fullName);
  if (!match) throw new Error("GitHub repository name is invalid");
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch))
    throw new Error("GitHub branch name is invalid");
  const ref = await githubFetch<{ object: { sha: string } }>(
    `https://api.github.com/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/git/ref/heads/${encodeURIComponent(branch)}`,
    token,
  );
  if (!/^[a-f0-9]{40}$/i.test(ref.object?.sha || ""))
    throw new Error("GitHub returned an invalid branch commit");
  const commit = await githubFetch<{ sha: string; tree: { sha: string } }>(
    `https://api.github.com/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/git/commits/${ref.object.sha}`,
    token,
  );
  if (!/^[a-f0-9]{40}$/i.test(commit.sha || "") || commit.sha.toLowerCase() !== ref.object.sha.toLowerCase() || !/^[a-f0-9]{40}$/i.test(commit.tree?.sha || ""))
    throw new Error("GitHub returned an invalid commit tree");
  const result = await githubFetch<{
    sha: string;
    truncated: boolean;
    tree: Array<{ path: string; type: string; size?: number }>;
  }>(
    `https://api.github.com/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/git/trees/${commit.tree.sha}?recursive=1`,
    token,
  );
  return {
    commitSha: ref.object.sha,
    truncated: Boolean(result.truncated),
    entries: result.tree
      .filter((entry) => entry.type === "blob" || entry.type === "tree")
      .slice(0, 5000),
  };
}

function standardBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function githubRequest<T>(
  url: string,
  token: string,
  init?: RequestInit,
  allowed: number[] = [200, 201],
) {
  return withGithubDeadline(init?.signal, async (signal) => {
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": API_VERSION,
        "user-agent": "WorldModel-for-Software",
        ...init?.headers,
      },
      signal,
    });
    let payload: unknown = null;
    if (response.status !== 204) {
      try {
        payload = await response.json();
      } catch (error) {
        if (isAbortFailure(error)) throw error;
      }
    }
    if (!allowed.includes(response.status))
      throw new Error(`GitHub request failed with status ${response.status}`);
    return { status: response.status, payload: payload as T };
  });
}

type DraftEvidenceInput = {
  installationId: string;
  owner: string;
  repository: string;
  baseBranch: string;
  headBranch: string;
  evidencePath: string;
  title: string;
  body: string;
  evidence: string;
};

export async function publishGithubDraftEvidenceWithToken(
  input: DraftEvidenceInput,
  token: string,
) {
  const root = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}`;
  const base = await githubRequest<{ object: { sha: string } }>(
    `${root}/git/ref/heads/${encodeURIComponent(input.baseBranch)}`,
    token,
  );
  const headRef = `${root}/git/ref/heads/${encodeURIComponent(input.headBranch)}`;
  const existingHead = await githubRequest<{ object: { sha: string } }>(
    headRef,
    token,
    undefined,
    [200, 404],
  );
  if (existingHead.status === 404)
    await githubRequest(`${root}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${input.headBranch}`,
        sha: base.payload.object.sha,
      }),
    });
  const contentUrl = `${root}/contents/${input.evidencePath.split("/").map(encodeURIComponent).join("/")}`;
  const existingFile = await githubRequest<{ sha: string }>(
    `${contentUrl}?ref=${encodeURIComponent(input.headBranch)}`,
    token,
    undefined,
    [200, 404],
  );
  await githubRequest(contentUrl, token, {
    method: "PUT",
    body: JSON.stringify({
      message: `chore: add WorldModel repair evidence`,
      content: standardBase64(input.evidence),
      branch: input.headBranch,
      ...(existingFile.status === 200 ? { sha: existingFile.payload.sha } : {}),
    }),
  });
  const existingPulls = await githubRequest<
    Array<{ number: number; html_url: string; draft: boolean }>
  >(
    `${root}/pulls?state=open&head=${encodeURIComponent(`${input.owner}:${input.headBranch}`)}&base=${encodeURIComponent(input.baseBranch)}`,
    token,
  );
  if (existingPulls.payload[0]) return existingPulls.payload[0];
  const created = await githubRequest<{
    number: number;
    html_url: string;
    draft: boolean;
  }>(`${root}/pulls`, token, {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      head: input.headBranch,
      base: input.baseBranch,
      body: input.body,
      draft: true,
      maintainer_can_modify: true,
    }),
  });
  return created.payload;
}

export async function publishGithubDraftFiles(input: { installationId: string; owner: string; repository: string; baseBranch: string; baseSha: string; headBranch: string; title: string; body: string; files: Array<{ path: string; content: string }> }) {
  const token = await installationToken(input.installationId);
  if (!/^[a-f0-9]{40}$/i.test(input.baseSha) || !/^worldmodel\/[a-z0-9._/-]{3,180}$/i.test(input.headBranch)) throw new Error("GitHub draft branch basis is invalid");
  if (!input.files.length || input.files.length > 30) throw new Error("GitHub draft requires 1-30 bounded files");
  for (const file of input.files) if (!/^[A-Za-z0-9_.\/-]{1,240}$/.test(file.path) || file.path.startsWith("/") || file.path.split("/").includes("..") || file.path.startsWith(".github/workflows/") || file.content.length > 1_000_000) throw new Error(`GitHub draft file is prohibited: ${file.path}`);
  const root = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}`;
  const headRef = `${root}/git/ref/heads/${input.headBranch.split("/").map(encodeURIComponent).join("/")}`;
  const existingHead = await githubRequest<{ object: { sha: string } }>(headRef, token, undefined, [200, 404]);
  if (existingHead.status === 404) await githubRequest(`${root}/git/refs`, token, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${input.headBranch}`, sha: input.baseSha }) });
  for (const file of input.files) {
    const contentUrl = `${root}/contents/${file.path.split("/").map(encodeURIComponent).join("/")}`;
    const existing = await githubRequest<{ sha: string }>(`${contentUrl}?ref=${encodeURIComponent(input.headBranch)}`, token, undefined, [200, 404]);
    await githubRequest(contentUrl, token, { method: "PUT", body: JSON.stringify({ message: `fix: WorldModel verified repair (${file.path})`, content: standardBase64(file.content), branch: input.headBranch, ...(existing.status === 200 ? { sha: existing.payload.sha } : {}) }) });
  }
  const existingPulls = await githubRequest<Array<{ number: number; html_url: string; draft: boolean }>>(`${root}/pulls?state=open&head=${encodeURIComponent(`${input.owner}:${input.headBranch}`)}&base=${encodeURIComponent(input.baseBranch)}`, token);
  if (existingPulls.payload[0]) return existingPulls.payload[0];
  return (await githubRequest<{ number: number; html_url: string; draft: boolean }>(`${root}/pulls`, token, { method: "POST", body: JSON.stringify({ title: input.title, head: input.headBranch, base: input.baseBranch, body: input.body, draft: true, maintainer_can_modify: true }) })).payload;
}

export async function publishGithubDraftEvidence(input: DraftEvidenceInput) {
  const token = await installationToken(input.installationId);
  return publishGithubDraftEvidenceWithToken(input, token);
}
