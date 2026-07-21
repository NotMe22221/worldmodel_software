import { composioConfiguration } from "./runtime-config.ts";

type JsonRecord = Record<string, unknown>;

const COMPOSIO_REQUEST_TIMEOUT_MS = 20_000;

export type ComposioConnectedAccount = {
  id: string;
  userId: string;
  authConfigId: string;
  toolkitSlug: string;
  status: string;
};

export type ComposioGithubRepository = {
  id: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  htmlUrl: string;
};

export type RepositorySource =
  | { kind: "github_app"; installationId: string }
  | { kind: "composio"; connectedAccountId: string; composioUserId: string };

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nestedData(value: unknown) {
  const root = record(value);
  const data = root.data;
  return data === undefined ? root : data;
}

function isAbortFailure(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  return name === "AbortError" || name === "TimeoutError";
}

async function withComposioDeadline<T>(callerSignal: AbortSignal | null | undefined, operation: (signal: AbortSignal) => Promise<T>) {
  const timeoutSignal = AbortSignal.timeout(COMPOSIO_REQUEST_TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  try {
    return await operation(signal);
  } catch (error) {
    if (timeoutSignal.aborted && (error === timeoutSignal.reason || isAbortFailure(error))) {
      throw new Error("Composio request timed out");
    }
    throw error;
  }
}

async function composioFetch(path: string, init?: RequestInit) {
  const config = await composioConfiguration();
  return withComposioDeadline(init?.signal, async (signal) => {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        ...init?.headers,
      },
      signal,
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch (error) {
      if (isAbortFailure(error)) throw error;
    }
    if (!response.ok) {
      const root = record(payload);
      const providerError = record(root.error);
      const detail = (text(providerError.message) || text(root.message)).replace(/[\r\n]+/g, " ").slice(0, 240);
      throw new Error(`Composio request failed with status ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return payload;
  });
}

function validateConnectUrl(value: unknown, baseUrl: string, fixtureMode: boolean) {
  const target = new URL(text(value));
  const hosted = target.protocol === "https:" && target.hostname === "connect.composio.dev";
  const configured = new URL(baseUrl);
  const localFixture = fixtureMode && target.protocol === "http:" && configured.protocol === "http:" && target.port === configured.port && ["127.0.0.1", "localhost"].includes(target.hostname) && ["127.0.0.1", "localhost"].includes(configured.hostname);
  if (!hosted && !localFixture) throw new Error("Composio returned an untrusted connection URL");
  return target.toString();
}

export async function createComposioGithubLink(userId: string, callbackUrl: string) {
  if (!/^wm_[a-f0-9]{40}$/.test(userId)) throw new Error("Composio user identity is invalid");
  const callback = new URL(callbackUrl);
  if (callback.protocol !== "https:" && !(callback.protocol === "http:" && ["127.0.0.1", "localhost"].includes(callback.hostname))) throw new Error("Composio callback URL is not allowed");
  const config = await composioConfiguration();
  const payload = record(await composioFetch("/connected_accounts/link", {
    method: "POST",
    body: JSON.stringify({
      auth_config_id: config.githubAuthConfigId,
      user_id: userId,
      callback_url: callback.toString(),
    }),
  }));
  const connectedAccountId = text(payload.connected_account_id);
  const linkToken = text(payload.link_token);
  if (!connectedAccountId || !linkToken) throw new Error("Composio returned an incomplete connection link");
  return {
    connectedAccountId,
    redirectUrl: validateConnectUrl(payload.redirect_url, config.baseUrl, config.fixtureMode),
    expiresAt: text(payload.expires_at) || new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

function normalizeAccount(value: unknown): ComposioConnectedAccount {
  const item = record(value);
  const toolkit = record(item.toolkit);
  const authConfig = record(item.auth_config);
  const authToolkit = record(authConfig.toolkit);
  const id = text(item.id) || text(item.connected_account_id);
  const userId = text(item.user_id);
  const authConfigId = text(item.auth_config_id) || text(authConfig.id);
  const toolkitSlug = text(item.toolkit_slug) || text(toolkit.slug) || text(authToolkit.slug);
  const status = text(item.status).toUpperCase();
  if (!id || !userId || !authConfigId || !toolkitSlug || !status) throw new Error("Composio returned an invalid connected account");
  return { id, userId, authConfigId, toolkitSlug, status };
}

export async function getComposioConnectedAccount(connectedAccountId: string) {
  const query = new URLSearchParams();
  query.append("connected_account_ids", connectedAccountId);
  const payload = record(await composioFetch(`/connected_accounts?${query}`));
  const items = Array.isArray(payload.items) ? payload.items : [];
  const account = items.find((candidate) => text(record(candidate).id) === connectedAccountId);
  if (!account) throw new Error("Composio GitHub connection was not found");
  return normalizeAccount(account);
}

async function executeGithubTool(toolSlug: string, connectedAccountId: string, userId: string, args: JsonRecord) {
  const payload = record(await composioFetch(`/tools/execute/${encodeURIComponent(toolSlug)}`, {
    method: "POST",
    body: JSON.stringify({ connected_account_id: connectedAccountId, user_id: userId, version: "latest", arguments: args }),
  }));
  if (payload.successful !== true) throw new Error(`Composio GitHub tool failed: ${toolSlug}`);
  return nestedData(payload);
}

async function executeGithubProxy(connectedAccountId: string, endpoint: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", body?: JsonRecord, allowedStatuses?: number[]) {
  const payload = record(await composioFetch("/tools/execute/proxy", {
    method: "POST",
    body: JSON.stringify({ connected_account_id: connectedAccountId, endpoint, method, ...(body ? { body } : {}) }),
  }));
  const status = Number(payload.status || 0);
  const allowed = allowedStatuses || [200, 201, 202, 204];
  if (!allowed.includes(status)) throw new Error(`Composio GitHub proxy failed with status ${status || "unknown"}`);
  return payload;
}

function utf8Base64(value: string) {
  return btoa(Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(""));
}

type ComposioDraftFilesInput = { connectedAccountId: string; owner: string; repository: string; baseBranch: string; baseSha: string; headBranch: string; title: string; body: string; files: Array<{ path: string; content: string }>; freshBranchFromBase?: boolean };
type ComposioDraftPull = { number: number; html_url: string; draft: boolean };

function sameComposioGithubSha(actual: unknown, expected: string) {
  const value = text(actual);
  return /^[a-f0-9]{40}$/i.test(value) && value.toLowerCase() === expected.toLowerCase();
}

function validatedComposioDraftPull(value: unknown, input: ComposioDraftFilesInput, expectedHeadSha: string) {
  const pull = record(value);
  const number = typeof pull.number === "number" ? pull.number : Number.NaN;
  const htmlUrl = text(pull.html_url);
  if (!Number.isSafeInteger(number) || number < 1 || !htmlUrl.startsWith("https://github.com/") || typeof pull.draft !== "boolean") throw new Error("Composio GitHub proxy returned an invalid draft pull request");
  const head = record(pull.head);
  const base = record(pull.base);
  const fullName = `${input.owner}/${input.repository}`.toLowerCase();
  if (
    text(pull.state) !== "open"
    || pull.merged_at != null
    || pull.draft !== true
    || text(head.ref) !== input.headBranch
    || !sameComposioGithubSha(head.sha, expectedHeadSha)
    || text(record(head.repo).full_name).toLowerCase() !== fullName
    || text(base.ref) !== input.baseBranch
    || text(record(base.repo).full_name).toLowerCase() !== fullName
  ) {
    throw new Error("github_conflict: Composio pull request is not an open draft at the verified branch head");
  }
  return { number, html_url: htmlUrl, draft: pull.draft } as ComposioDraftPull;
}

async function existingComposioDraftPull(root: string, input: ComposioDraftFilesInput, expectedHeadSha: string) {
  const pulls = await executeGithubProxy(input.connectedAccountId, `${root}/pulls?state=all&head=${encodeURIComponent(`${input.owner}:${input.headBranch}`)}&base=${encodeURIComponent(input.baseBranch)}`, "GET");
  if (!Array.isArray(pulls.data)) throw new Error("Composio GitHub proxy returned an invalid pull request list");
  return pulls.data.length ? validatedComposioDraftPull(pulls.data[0], input, expectedHeadSha) : null;
}

async function verifiedComposioFreshBranchHead(root: string, input: ComposioDraftFilesInput, expectedTreeSha: string) {
  const headPath = input.headBranch.split("/").map(encodeURIComponent).join("/");
  const head = await executeGithubProxy(input.connectedAccountId, `${root}/git/ref/heads/${headPath}`, "GET", undefined, [200, 404]);
  if (Number(head.status) === 404) return null;
  const headData = record(head.data);
  const headSha = text(record(headData.object).sha);
  if (!/^[a-f0-9]{40}$/i.test(headSha)) throw new Error("Composio returned an invalid draft branch");
  const commit = record((await executeGithubProxy(input.connectedAccountId, `${root}/git/commits/${headSha}`, "GET")).data);
  const parents = Array.isArray(commit.parents) ? commit.parents.map(record) : [];
  if (
    !sameComposioGithubSha(commit.sha, headSha)
    || !sameComposioGithubSha(record(commit.tree).sha, expectedTreeSha)
    || parents.length !== 1
    || !sameComposioGithubSha(parents[0].sha, input.baseSha)
  ) {
    throw new Error("Composio draft branch conflicts with the approved repair candidate");
  }
  return headSha;
}

export async function publishComposioGithubDraftFiles(input: ComposioDraftFilesInput) {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(input.owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(input.repository) || !/^[A-Za-z0-9._/-]{1,120}$/.test(input.baseBranch) || !/^[a-f0-9]{40}$/i.test(input.baseSha) || !/^worldmodel\/[a-z0-9._/-]{3,180}$/i.test(input.headBranch)) throw new Error("Composio draft branch basis is invalid");
  if (!input.files.length || input.files.length > 30) throw new Error("Composio draft requires 1-30 bounded files");
  for (const file of input.files) if (!/^[A-Za-z0-9_.\/-]{1,240}$/.test(file.path) || file.path.startsWith("/") || file.path.split("/").includes("..") || file.path.toLowerCase().startsWith(".github/workflows/") || file.content.length > 1_000_000) throw new Error(`Composio draft file is prohibited: ${file.path}`);
  const root = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}`;
  if (input.freshBranchFromBase) {
    const baseCommit = record((await executeGithubProxy(input.connectedAccountId, `${root}/git/commits/${input.baseSha}`, "GET")).data);
    const baseTree = record(baseCommit.tree);
    if (text(baseCommit.sha).toLowerCase() !== input.baseSha.toLowerCase() || !/^[a-f0-9]{40}$/i.test(text(baseTree.sha))) throw new Error("Composio returned an invalid approved base commit");
    const treeEntries: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
    for (const file of input.files) {
      const blob = record((await executeGithubProxy(input.connectedAccountId, `${root}/git/blobs`, "POST", { content: utf8Base64(file.content), encoding: "base64" }, [201])).data);
      if (!/^[a-f0-9]{40}$/i.test(text(blob.sha))) throw new Error("Composio returned an invalid candidate blob");
      treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: text(blob.sha) });
    }
    const tree = record((await executeGithubProxy(input.connectedAccountId, `${root}/git/trees`, "POST", { base_tree: text(baseTree.sha), tree: treeEntries }, [201])).data);
    if (!/^[a-f0-9]{40}$/i.test(text(tree.sha))) throw new Error("Composio returned an invalid candidate tree");
    const candidateTreeSha = text(tree.sha);
    let headSha = await verifiedComposioFreshBranchHead(root, input, candidateTreeSha);
    if (!headSha) {
      const commit = record((await executeGithubProxy(input.connectedAccountId, `${root}/git/commits`, "POST", { message: "fix: WorldModel verified repair candidate", tree: candidateTreeSha, parents: [input.baseSha] }, [201])).data);
      if (!/^[a-f0-9]{40}$/i.test(text(commit.sha))) throw new Error("Composio returned an invalid candidate commit");
      const createdRef = await executeGithubProxy(input.connectedAccountId, `${root}/git/refs`, "POST", { ref: `refs/heads/${input.headBranch}`, sha: text(commit.sha) }, [201, 422]);
      if (Number(createdRef.status) === 201) headSha = text(commit.sha);
      else headSha = await verifiedComposioFreshBranchHead(root, input, candidateTreeSha);
      if (!headSha) throw new Error("Composio draft branch creation conflicted without a reusable branch");
    }
    const existingPull = await existingComposioDraftPull(root, input, headSha);
    if (existingPull) return existingPull;
    const created = await executeGithubProxy(input.connectedAccountId, `${root}/pulls`, "POST", { title: input.title, head: input.headBranch, base: input.baseBranch, body: input.body, draft: true, maintainer_can_modify: true }, [201, 422]);
    if (Number(created.status) === 201) return validatedComposioDraftPull(created.data, input, headSha);
    const racedPull = await existingComposioDraftPull(root, input, headSha);
    if (racedPull) return racedPull;
    throw new Error("Composio draft pull request creation conflicted without a reusable pull request");
  }
  const headPath = input.headBranch.split("/").map(encodeURIComponent).join("/");
  const existingHead = await executeGithubProxy(input.connectedAccountId, `${root}/git/ref/heads/${headPath}`, "GET", undefined, [200, 404]);
  if (Number(existingHead.status) === 404) await executeGithubProxy(input.connectedAccountId, `${root}/git/refs`, "POST", { ref: `refs/heads/${input.headBranch}`, sha: input.baseSha });
  for (const file of input.files) {
    const contentUrl = `${root}/contents/${file.path.split("/").map(encodeURIComponent).join("/")}`;
    const existing = await executeGithubProxy(input.connectedAccountId, `${contentUrl}?ref=${encodeURIComponent(input.headBranch)}`, "GET", undefined, [200, 404]);
    const existingData = record(existing.data);
    await executeGithubProxy(input.connectedAccountId, contentUrl, "PUT", { message: `fix: WorldModel verified repair (${file.path})`, content: utf8Base64(file.content), branch: input.headBranch, ...(Number(existing.status) === 200 && text(existingData.sha) ? { sha: text(existingData.sha) } : {}) });
  }
  const pulls = await executeGithubProxy(input.connectedAccountId, `${root}/pulls?state=open&head=${encodeURIComponent(`${input.owner}:${input.headBranch}`)}&base=${encodeURIComponent(input.baseBranch)}`, "GET");
  const existingPulls = Array.isArray(pulls.data) ? pulls.data : [];
  const first = record(existingPulls[0]);
  if (typeof first.number === "number" && text(first.html_url)) return { number: first.number, html_url: text(first.html_url), draft: first.draft === true };
  const created = await executeGithubProxy(input.connectedAccountId, `${root}/pulls`, "POST", { title: input.title, head: input.headBranch, base: input.baseBranch, body: input.body, draft: true, maintainer_can_modify: true });
  const data = record(created.data);
  if (typeof data.number !== "number" || !text(data.html_url)) throw new Error("Composio GitHub proxy returned an invalid draft pull request");
  return { number: data.number, html_url: text(data.html_url), draft: data.draft === true };
}

function repositoryArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const root = record(value);
  for (const key of ["repositories", "items", "data"]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  return [];
}

export async function listComposioGithubRepositories(connectedAccountId: string, userId: string) {
  const data = await executeGithubTool("GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER", connectedAccountId, userId, {
    per_page: 100,
    page: 1,
    affiliation: "owner,collaborator,organization_member",
    sort: "updated",
    direction: "desc",
  });
  return repositoryArray(data).slice(0, 100).map((value) => {
    const repository = record(value);
    const id = String(repository.id || "").trim();
    const fullName = text(repository.full_name);
    const defaultBranch = text(repository.default_branch) || "main";
    if (!/^\d+$/.test(id) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName) || !/^[A-Za-z0-9._/-]{1,120}$/.test(defaultBranch)) return null;
    return {
      id,
      fullName,
      defaultBranch,
      isPrivate: repository.private === true,
      htmlUrl: text(repository.html_url) || `https://github.com/${fullName}`,
    } satisfies ComposioGithubRepository;
  }).filter((repository): repository is ComposioGithubRepository => repository !== null);
}

export async function getComposioGithubIdentity(connectedAccountId: string, userId: string) {
  const data = record(await executeGithubTool("GITHUB_GET_THE_AUTHENTICATED_USER", connectedAccountId, userId, {}));
  const login = text(data.login) || text(record(data.user).login);
  return { login: /^[A-Za-z0-9-]{1,100}$/.test(login) ? login : "GitHub account" };
}

function findCommitSha(value: unknown) {
  const root = record(value);
  const candidates = [root.sha, record(root.commit).sha, record(root.data).sha];
  return candidates.map(text).find((candidate) => /^[a-f0-9]{40}$/i.test(candidate)) || "";
}

export async function getComposioGithubCommit(connectedAccountId: string, userId: string, fullName: string, branch: string) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(fullName);
  if (!match) throw new Error("GitHub repository name is invalid");
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch)) throw new Error("GitHub branch name is invalid");
  const basis = await executeGithubTool("GITHUB_GET_A_COMMIT", connectedAccountId, userId, { owner: match[1], repo: match[2], ref: branch });
  const commitSha = findCommitSha(basis);
  if (!commitSha) throw new Error("Composio could not resolve an immutable GitHub commit");
  return commitSha;
}

export async function getComposioGithubFileAtCommit(connectedAccountId: string, fullName: string, filePath: string, commitSha: string) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(fullName);
  if (!match || !/^[A-Za-z0-9_.\/-]{1,240}$/.test(filePath) || filePath.startsWith("/") || filePath.split("/").includes("..") || !/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error("GitHub workflow revision is invalid");
  const root = `https://api.github.com/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`;
  const file = record((await executeGithubProxy(connectedAccountId, `${root}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(commitSha)}`, "GET")).data);
  if (text(file.type) !== "file" || text(file.encoding) !== "base64" || typeof file.content !== "string" || !Number.isSafeInteger(file.size) || Number(file.size) < 1 || Number(file.size) > 100_000) throw new Error("GitHub workflow file is invalid");
  let content: Uint8Array;
  try {
    const binary = atob(file.content.replace(/\s/g, ""));
    content = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("GitHub workflow file is invalid");
  }
  if (content.byteLength !== file.size) throw new Error("GitHub workflow file size is invalid");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new Error("GitHub workflow file encoding is invalid");
  }
}

export async function getComposioGithubArchiveUrl(connectedAccountId: string, fullName: string, commitSha: string) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(fullName);
  if (!match || !/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error("Composio archive basis is invalid");
  const payload = await executeGithubProxy(connectedAccountId, `https://api.github.com/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/tarball/${commitSha}`, "GET");
  const binary = record(payload.binary_data);
  const url = new URL(text(binary.url));
  const size = Number(binary.size || 0);
  const expiresAt = Date.parse(text(binary.expires_at));
  if (url.protocol !== "https:" || (size && size > 500 * 1024 * 1024) || (Number.isFinite(expiresAt) && expiresAt <= Date.now() + 30_000)) throw new Error("Composio returned an unsafe or expired repository archive");
  return { url: url.toString(), size, contentType: text(binary.content_type) || "application/octet-stream", expiresAt: Number.isFinite(expiresAt) ? new Date(expiresAt).toISOString() : null };
}

function findTree(value: unknown): JsonRecord {
  const root = record(value);
  if (Array.isArray(root.tree)) return root;
  const data = record(root.data);
  if (Array.isArray(data.tree)) return data;
  return root;
}

export async function getComposioGithubTree(connectedAccountId: string, userId: string, fullName: string, branch: string) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(fullName);
  if (!match) throw new Error("GitHub repository name is invalid");
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch)) throw new Error("GitHub branch name is invalid");
  const commitSha = await getComposioGithubCommit(connectedAccountId, userId, fullName, branch);
  const treeResult = findTree(await executeGithubTool("GITHUB_GET_A_TREE", connectedAccountId, userId, { owner: match[1], repo: match[2], tree_sha: commitSha, recursive: "true" }));
  const tree = Array.isArray(treeResult.tree) ? treeResult.tree : [];
  const entries = tree.map((value) => {
    const item = record(value);
    const path = text(item.path);
    const type = text(item.type);
    const size = typeof item.size === "number" ? item.size : undefined;
    return path && (type === "blob" || type === "tree") ? { path, type, ...(size === undefined ? {} : { size }) } : null;
  }).filter((item): item is { path: string; type: string; size?: number } => item !== null).slice(0, 5000);
  if (!entries.length) throw new Error("Composio returned an empty GitHub tree");
  return { commitSha, truncated: treeResult.truncated === true || tree.length > 5000, entries };
}

export async function revokeComposioConnection(connectedAccountId: string) {
  await composioFetch(`/connected_accounts/${encodeURIComponent(connectedAccountId)}/revoke`, { method: "POST", body: "{}" });
}
