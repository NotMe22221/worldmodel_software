import { WorkerEntrypoint } from "cloudflare:workers";
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import { installationToken } from "../server/github";
import { getComposioGithubArchiveUrl, type RepositorySource } from "../server/composio";

type NativeRunnerEnv = { Sandbox: DurableObjectNamespace<Sandbox>; RUNNER_EVIDENCE_SECRET: string };
type Manifest = { packageManager: "npm" | "pnpm" | "yarn"; install: string; seed?: string; services: Array<{ id: string; root: string; start: string; port: number; healthCheck: string }>; journeyCommands: string[]; resources: { timeoutSeconds: number } };
type Scenario = { name: string; environmentRevisionId: string; seed: string; durationSeconds: number; workload: { baselineRps: number; peakMultiplier: number }; faults: Array<{ kind: string; target: string; durationSeconds: number; latencyMs?: number; responseCode?: number }>; journeyIds: string[] };

function shellQuote(value: string) { return `'${value.replaceAll("'", `'"'"'`)}'`; }

async function materializeRepository(sandbox: Sandbox, input: { repository: string; branch: string; repositorySource: RepositorySource; commitSha?: string }, depth: number) {
  if (input.repositorySource.kind === "github_app") {
    const token = await installationToken(input.repositorySource.installationId);
    const clone = await sandbox.gitCheckout(`https://x-access-token:${encodeURIComponent(token)}@github.com/${input.repository}.git`, { branch: input.branch, targetDir: "/workspace/repository", depth, cloneTimeoutMs: 180000 });
    if (!clone.success) throw new Error("Repository clone failed");
    await sandbox.exec(`git -C /workspace/repository remote set-url origin https://github.com/${input.repository}.git`);
    if (input.commitSha) {
      const checkout = await sandbox.exec(`git -C /workspace/repository checkout --detach ${input.commitSha}`, { timeout: 30000 });
      if (!checkout.success) throw new Error("Approved commit is not available in the bounded clone");
    }
    const head = await sandbox.exec("git -C /workspace/repository rev-parse HEAD");
    const commitSha = head.stdout.trim();
    if (!/^[a-f0-9]{40}$/i.test(commitSha) || (input.commitSha && commitSha !== input.commitSha)) throw new Error("Runner commit differs from the approved model basis");
    return commitSha;
  }
  if (!input.commitSha || !/^[a-f0-9]{40}$/i.test(input.commitSha)) throw new Error("Composio execution requires an exact commit");
  const archive = await getComposioGithubArchiveUrl(input.repositorySource.connectedAccountId, input.repository, input.commitSha);
  const command = `mkdir -p /workspace/repository && curl --fail --location --silent --show-error --output /workspace/repository.tar.gz ${shellQuote(archive.url)} && tar -xzf /workspace/repository.tar.gz --strip-components=1 -C /workspace/repository && rm /workspace/repository.tar.gz`;
  const extracted = await sandbox.exec(command, { timeout: 180000 });
  if (!extracted.success) throw new Error(`Composio repository archive extraction failed: ${extracted.stderr.slice(-300)}`);
  return input.commitSha;
}

const extractor = String.raw`
import fs from "node:fs"; import path from "node:path";
const root = "/workspace/repository", ignored = new Set(["node_modules",".git","dist","build",".next","coverage"]), files = [];
function walk(dir){ for(const entry of fs.readdirSync(dir,{withFileTypes:true})){ if(ignored.has(entry.name)) continue; const full=path.join(dir,entry.name); if(entry.isDirectory()) walk(full); else if(files.length<12000) files.push(full); } }
walk(root); const rel=p=>path.relative(root,p).replaceAll("\\\\","/"); const source=files.filter(f=>/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));
const nodes=[], edges=[], seen=new Set(); const add=(id,name,kind,evidence)=>{if(!seen.has(id)){seen.add(id);nodes.push({id,name,kind,evidence});}};
for(const file of files.filter(f=>path.basename(f)==="package.json")){ try{const pkg=JSON.parse(fs.readFileSync(file,"utf8")); const id="pkg_"+rel(path.dirname(file)).replace(/[^a-z0-9]+/gi,"_").toLowerCase(); add(id,pkg.name||rel(path.dirname(file))||"application",rel(file)==="package.json"?"application":"service",[rel(file)]); }catch{} }
for(const file of source){ const r=rel(file), text=fs.readFileSync(file,"utf8"); if(/(?:app|pages)\/(?:api\/)?[^/]+\.(?:ts|tsx|js|jsx)$/.test(r)||/\.(get|post|put|delete)\s*\(/i.test(text)) add("route_"+r.replace(/[^a-z0-9]+/gi,"_"),path.basename(r).replace(/\.[^.]+$/,"") ,"route",[r]); if(/prisma|drizzle|mongoose|postgres|mysql|sqlite|redis/i.test(text)) add("data_"+r.replace(/[^a-z0-9]+/gi,"_"),path.basename(r),"datastore",[r]); if(/bullmq|kafka|sqs|queue|pubsub/i.test(text)) add("queue_"+r.replace(/[^a-z0-9]+/gi,"_"),path.basename(r),"queue",[r]); if(/fetch\(|axios|graphql-request|stripe|twilio|sendgrid/i.test(text)) add("external_"+r.replace(/[^a-z0-9]+/gi,"_"),path.basename(r),"external_api",[r]); }
const packageNodes=nodes.filter(n=>n.kind==="application"||n.kind==="service"); for(const node of nodes.filter(n=>!packageNodes.includes(n))){ const owner=[...packageNodes].sort((a,b)=>b.evidence[0].length-a.evidence[0].length).find(p=>node.evidence[0].startsWith(path.dirname(p.evidence[0]).replaceAll("\\\\","/")))||packageNodes[0]; if(owner) edges.push({source:owner.id,target:node.id,kind:"contains",evidence:node.evidence}); }
const rootPkg=files.find(f=>rel(f)==="package.json"); let packageManager="npm"; if(files.some(f=>rel(f)==="pnpm-lock.yaml"))packageManager="pnpm"; else if(files.some(f=>rel(f)==="yarn.lock"))packageManager="yarn"; let pkg={}; try{pkg=JSON.parse(fs.readFileSync(rootPkg,"utf8"));}catch{}
const compose=files.filter(f=>/docker-compose.*\.ya?ml$/i.test(f)).map(rel); const ts=files.some(f=>/tsconfig.*\.json$/.test(rel(f)))||source.some(f=>/\.tsx?$/.test(f));
console.log(JSON.stringify({repositoryType:ts?"node_typescript":rootPkg?"configuration_required":"unsupported",extractorVersion:"wm-ts-2",confidence:Math.min(97,65+Math.floor(nodes.filter(n=>n.evidence.length).length/2)),graph:{version:2,nodes,edges},manifestProposal:{version:1,packageManager,nodeVersion:"22",install:packageManager==="npm"?"npm ci":packageManager==="pnpm"?"pnpm install --frozen-lockfile":"yarn install --frozen-lockfile",services:[{id:"app",name:pkg.name||"Application",root:".",start:pkg.scripts?.dev?packageManager+" run dev":packageManager+" start",port:3000,healthCheck:"/",dependsOn:[]}],testCommands:pkg.scripts?.test?[packageManager+" test"]:[],journeyCommands:["npx playwright test"],mocks:[],secretRefs:[],supportedFaults:["traffic_surge","dependency_outage","database_latency"],resources:{cpu:1,memoryMb:2048,timeoutSeconds:900,network:"registries"}},unsupportedReasons:compose.length?["Docker Compose detected; use the GitHub Actions execution backend"]:[]}));
`;

function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join(""); }
async function sign(body: string, secret: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))); }

const measureScript = String.raw`
const [url,countRaw]=process.argv.slice(2); const count=Math.max(1,Math.min(500,Number(countRaw)||20)), times=[]; let errors=0;
await Promise.all(Array.from({length:count},async()=>{const start=performance.now();try{const response=await fetch(url);if(!response.ok)errors++;}catch{errors++;}times.push(performance.now()-start);}));
times.sort((a,b)=>a-b); console.log(JSON.stringify({requests:count,errorRate:Number((errors/count*100).toFixed(2)),latencyMs:Math.round(times[Math.min(times.length-1,Math.floor(times.length*.95))]||0)}));
`;

export class NativeSandboxRunner extends WorkerEntrypoint<NativeRunnerEnv> {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/v1/runs" && request.method === "POST") return this.runObserved(request);
    if (url.pathname !== "/v1/scans" || request.method !== "POST") return new Response("Not found", { status: 404 });
    const input = await request.json() as { scanId: string; repository: string; branch: string; repositorySource: RepositorySource; commitSha?: string };
    if (!/^[\w.-]+\/[\w.-]+$/.test(input.repository) || !/^[\w./-]{1,200}$/.test(input.branch) || !/^scan_[a-z0-9]+$/i.test(input.scanId)) return new Response("Invalid scan request", { status: 400 });
    const sandbox = getSandbox(this.env.Sandbox, input.scanId, { sleepAfter: "10m" });
    try {
      if (!input.repositorySource || !["github_app", "composio"].includes(input.repositorySource.kind)) throw new Error("Repository source is invalid");
      const commitSha = await materializeRepository(sandbox, input, 1);
      await sandbox.writeFile("/workspace/extract.mjs", extractor);
      const extraction = await sandbox.exec("node /workspace/extract.mjs", { timeout: 120000 });
      if (!extraction.success) throw new Error(`TypeScript extraction failed: ${extraction.stderr.slice(0, 300)}`);
      const result = JSON.parse(extraction.stdout.trim());
      const body = JSON.stringify({ ...result, commitSha, clonedAt: new Date().toISOString() });
      return new Response(body, { headers: { "content-type": "application/json", "x-worldmodel-signature": await sign(body, this.env.RUNNER_EVIDENCE_SECRET) } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Scan failed" }, { status: 500 });
    } finally {
      await sandbox.destroy();
    }
  }

  private async runObserved(request: Request) {
    const input = await request.json() as { runId: string; repository: string; branch: string; repositorySource: RepositorySource; commitSha: string; scenarioFingerprint: string; manifest: Manifest; scenario: Scenario };
    if (!/^[\w.-]+\/[\w.-]+$/.test(input.repository) || !/^[a-f0-9]{40}$/i.test(input.commitSha) || !/^crun_[a-z0-9]+$/i.test(input.runId)) return new Response("Invalid run request", { status: 400 });
    const sandbox = getSandbox(this.env.Sandbox, input.runId, { sleepAfter: "10m" });
    const startedAt = new Date().toISOString(), events: Array<{ type: string; source: string; serviceId?: string; payload?: Record<string, unknown> }> = [];
    let result: Record<string, unknown> | null = null;
    try {
      events.push({ type: "environment.provisioning", source: "cloudflare-sandbox", payload: { commitSha: input.commitSha } });
      if (!input.repositorySource || !["github_app", "composio"].includes(input.repositorySource.kind)) throw new Error("Repository source is invalid");
      await materializeRepository(sandbox, input, 50);
      const timeout = Math.min(3_600_000, Math.max(30_000, input.manifest.resources.timeoutSeconds * 1000));
      const install = await sandbox.exec(input.manifest.install, { cwd: "/workspace/repository", timeout });
      if (!install.success) throw new Error(`Dependency installation failed: ${install.stderr.slice(-500)}`);
      if (input.manifest.seed) { const seed = await sandbox.exec(input.manifest.seed, { cwd: "/workspace/repository", timeout }); if (!seed.success) throw new Error(`Seed command failed: ${seed.stderr.slice(-500)}`); }
      for (const service of input.manifest.services) await sandbox.startProcess(service.start, { cwd: `/workspace/repository/${service.root}`, processId: `svc-${service.id}`, autoCleanup: false });
      for (const service of input.manifest.services) { const health = await sandbox.exec(`curl --fail --silent --show-error --retry 30 --retry-delay 1 http://127.0.0.1:${service.port}${service.healthCheck}`, { timeout: 45000 }); if (!health.success) throw new Error(`Health check failed for ${service.id}`); }
      events.push({ type: "environment.ready", source: "cloudflare-sandbox", payload: { services: input.manifest.services.map((service) => service.id) } });
      await sandbox.writeFile("/workspace/measure.mjs", measureScript);
      const primary = input.manifest.services[0]; const healthUrl = `http://127.0.0.1:${primary.port}${primary.healthCheck}`;
      events.push({ type: "baseline.started", source: "worldmodel-runner" });
      const baselineMeasure = await sandbox.exec(`node /workspace/measure.mjs ${healthUrl} 20`, { timeout: 60000 });
      if (!baselineMeasure.success) throw new Error("Baseline measurement failed");
      const baseline = JSON.parse(baselineMeasure.stdout.trim()) as { errorRate: number; latencyMs: number };
      let baselineJourneyPassed = true;
      for (const command of input.manifest.journeyCommands) { const journey = await sandbox.exec(command, { cwd: "/workspace/repository", timeout }); baselineJourneyPassed &&= journey.success; }
      const before = { score: Math.max(0, Math.round(100 - baseline.errorRate * 2 - Math.max(0, baseline.latencyMs - 500) / 50 - (baselineJourneyPassed ? 0 : 40))), errorRate: `${baseline.errorRate}%`, latencyMs: baseline.latencyMs, journeySuccess: baselineJourneyPassed ? 100 : 0, serviceHealth: 100 };
      events.push({ type: "baseline.completed", source: "worldmodel-runner", payload: before });
      const packageFile = await sandbox.readFile("/workspace/repository/package.json"); const scripts = JSON.parse(packageFile.content).scripts || {};
      for (const fault of input.scenario.faults) {
        events.push({ type: "fault.injected", source: "worldmodel-runner", serviceId: fault.target, payload: fault as unknown as Record<string, unknown> });
        if (fault.kind !== "traffic_surge") {
          if (!scripts["worldmodel:fault"]) throw new Error(`${fault.kind} requires an approved worldmodel:fault adapter in package.json`);
          const encoded = btoa(JSON.stringify(fault)); const command = `${input.manifest.packageManager} run worldmodel:fault -- ${encoded}`;
          const injected = await sandbox.exec(command, { cwd: "/workspace/repository", timeout: Math.min(timeout, fault.durationSeconds * 1000 + 30000), env: { WORLDMODEL_SCENARIO_SEED: input.scenario.seed } });
          if (!injected.success) throw new Error(`Fault adapter failed for ${fault.kind}`);
        }
      }
      const requestCount = Math.min(500, Math.max(20, Math.round(input.scenario.workload.baselineRps * input.scenario.workload.peakMultiplier * Math.min(input.scenario.durationSeconds, 10))));
      events.push({ type: "load.changed", source: "worldmodel-runner", payload: { requests: requestCount, multiplier: input.scenario.workload.peakMultiplier } });
      const failureMeasure = await sandbox.exec(`node /workspace/measure.mjs ${healthUrl} ${requestCount}`, { timeout: Math.min(timeout, 180000) });
      if (!failureMeasure.success) throw new Error("Failure-window measurement failed");
      const failure = JSON.parse(failureMeasure.stdout.trim()) as { errorRate: number; latencyMs: number };
      let journeyPassed = true; for (const command of input.manifest.journeyCommands) { const journey = await sandbox.exec(command, { cwd: "/workspace/repository", timeout, env: { WORLDMODEL_SCENARIO_SEED: input.scenario.seed } }); journeyPassed &&= journey.success; }
      const after = { score: Math.max(0, Math.round(100 - failure.errorRate * 2 - Math.max(0, failure.latencyMs - 500) / 50 - (journeyPassed ? 0 : 40))), errorRate: `${failure.errorRate}%`, latencyMs: failure.latencyMs, journeySuccess: journeyPassed ? 100 : 0, serviceHealth: Math.max(0, Math.round(100 - failure.errorRate)) };
      result = { status: "completed", before, after, scenarioFingerprint: input.scenarioFingerprint, seed: input.scenario.seed, environmentId: input.scenario.environmentRevisionId, startedAt, endedAt: new Date().toISOString(), events };
    } catch (error) {
      result = { status: "failed", error: error instanceof Error ? error.message : "Observed run failed", scenarioFingerprint: input.scenarioFingerprint, seed: input.scenario.seed, startedAt, endedAt: new Date().toISOString(), events: [...events, { type: "run.failed", source: "cloudflare-sandbox", payload: { safeMessage: error instanceof Error ? error.message : "Run failed" } }] };
    }
    try { await sandbox.destroy(); } finally {
      const body = JSON.stringify({ ...result, environmentDestroyedAt: new Date().toISOString() });
      return new Response(body, { status: 200, headers: { "content-type": "application/json", "x-worldmodel-signature": await sign(body, this.env.RUNNER_EVIDENCE_SECRET) } });
    }
  }
}
