export const MAX_CANDIDATE_ARTIFACT_BYTES = 35_000_000;

export type PublishableCandidateArtifact = {
  commitSha: string;
  strategy: string;
  files: Array<{ path: string; content: string }>;
};

const artifactHash = /^[a-f0-9]{64}$/i;
const commitHash = /^[a-f0-9]{40}$/i;
const filePath = /^[A-Za-z0-9_.\/-]{1,240}$/;
const strategyName = /^[A-Za-z0-9 _./:-]{1,100}$/;

function bytes(value: ArrayBuffer) {
  return new Uint8Array(value);
}

export async function candidateArtifactSha256(value: ArrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyCandidateArtifact(
  value: ArrayBuffer,
  metadata: { sha256: string; sizeBytes: number },
): Promise<PublishableCandidateArtifact> {
  const content = bytes(value);
  if (
    !Number.isSafeInteger(metadata.sizeBytes)
    || metadata.sizeBytes < 1
    || metadata.sizeBytes > MAX_CANDIDATE_ARTIFACT_BYTES
    || content.byteLength !== metadata.sizeBytes
  ) {
    throw new Error("artifact_integrity_error: Candidate artifact size does not match its approved metadata");
  }
  if (!artifactHash.test(metadata.sha256) || await candidateArtifactSha256(value) !== metadata.sha256.toLowerCase()) {
    throw new Error("artifact_integrity_error: Candidate artifact digest does not match its approved metadata");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content));
  } catch {
    throw new Error("candidate_invalid: Candidate artifact must be valid UTF-8 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("candidate_invalid: Candidate artifact must be a JSON object");
  const candidate = parsed as Record<string, unknown>;
  const commitSha = typeof candidate.commitSha === "string" ? candidate.commitSha.toLowerCase() : "";
  const strategy = typeof candidate.strategy === "string" && candidate.strategy.trim() ? candidate.strategy.trim() : "repair";
  if (!commitHash.test(commitSha) || !strategyName.test(strategy)) throw new Error("candidate_invalid: Candidate commit and strategy are invalid");
  if (!Array.isArray(candidate.files) || candidate.files.length < 1 || candidate.files.length > 30) throw new Error("candidate_invalid: Candidate must contain 1-30 bounded files");

  const seen = new Set<string>();
  const files = candidate.files.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("candidate_invalid: Candidate files are malformed");
    const file = entry as Record<string, unknown>;
    const path = typeof file.path === "string" ? file.path : "";
    const content = typeof file.content === "string" ? file.content : "";
    if (
      !filePath.test(path)
      || path.startsWith("/")
      || path.split("/").includes("..")
      || path.toLowerCase().startsWith(".github/workflows/")
      || content.length > 1_000_000
      || seen.has(path)
    ) {
      throw new Error("candidate_invalid: Candidate file is prohibited: " + (path || "unknown"));
    }
    seen.add(path);
    return { path, content };
  });

  return { commitSha, strategy, files };
}
