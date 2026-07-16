const manifestNames = new Map([
  ["package.json", "Node.js application"],
  ["pyproject.toml", "Python application"],
  ["requirements.txt", "Python application"],
  ["go.mod", "Go application"],
  ["pom.xml", "Java application"],
  ["build.gradle", "Java application"],
  ["docker-compose.yml", "Container environment"],
  ["docker-compose.yaml", "Container environment"],
]);

function componentId(value) {
  return `cmp_${value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 70) || "root"}`;
}

export function buildRepositoryGraph(entries, metadata = {}) {
  if (!Array.isArray(entries)) throw new Error("Repository tree is required");
  const paths = [...new Set(entries.map((entry) => typeof entry === "string" ? entry : entry?.path).filter((path) => typeof path === "string" && path.length > 0 && path.length <= 500))].sort().slice(0, 5000);
  const components = new Map();
  function add(path, name, kind, confidence, evidence) {
    const key = path || ".";
    const existing = components.get(key);
    if (existing) {
      if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
      return;
    }
    if (components.size >= 250) return;
    components.set(key, { id: componentId(key), name, kind, path: key, confidence, evidence: [evidence] });
  }
  add(".", metadata.repository || "Repository", "application", "observed", "GitHub repository root");
  for (const path of paths) {
    const parts = path.split("/");
    const filename = parts.at(-1).toLowerCase();
    if (manifestNames.has(filename)) {
      const directory = parts.slice(0, -1).join("/") || ".";
      const display = directory === "." ? manifestNames.get(filename) : directory.split("/").at(-1).replaceAll("-", " ");
      add(directory, display, directory === "." ? "application" : "service", "observed", path);
    }
    if (["apps", "services", "packages"].includes(parts[0]) && parts[1]) {
      const directory = `${parts[0]}/${parts[1]}`;
      add(directory, parts[1].replaceAll("-", " "), parts[0] === "packages" ? "package" : "service", "inferred", path);
    }
    if (/^(prisma|migrations|database|db)\//.test(path))
      add(parts[0], parts[0] === "db" ? "database" : parts[0], "datastore", "inferred", path);
    if (/^(playwright\.config\.|tests?\/.*playwright|e2e\/)/.test(path))
      add("journey-tests", "Playwright journeys", "journey", "observed", path);
  }
  const nodes = [...components.values()].map((component) => ({ ...component, evidence: component.evidence.slice(0, 5) }));
  const root = nodes[0];
  const edges = nodes.slice(1).map((node) => ({ id: `edge_${root.id}_${node.id}`, source: root.id, target: node.id, relation: node.kind === "journey" ? "tests" : "contains" }));
  return {
    version: 1,
    source: "github_tree",
    repository: metadata.repository || null,
    branch: metadata.branch || null,
    commitSha: metadata.commitSha || null,
    scannedPathCount: paths.length,
    truncated: Boolean(metadata.truncated),
    nodes,
    edges,
  };
}
