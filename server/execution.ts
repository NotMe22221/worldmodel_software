import type { CampaignPlan, WorldModelManifest } from "@/worldmodel/product-contracts";
import type { RepositorySource } from "./composio.ts";
import { getRuntimeEnv } from "./runtime-env";
import { evaluateCampaignExecutionReadiness } from "@/worldmodel/execution-readiness.mjs";

type WorkflowBinding = { create(input: { id?: string; params: Record<string, unknown> }): Promise<{ id: string }> };
type RuntimeEnvironment = Record<string, unknown>;

async function runtime() {
  return await getRuntimeEnv() as RuntimeEnvironment;
}

export async function campaignExecutionReadiness(backend: string) {
  return evaluateCampaignExecutionReadiness(await runtime(), backend);
}

export async function requireCampaignExecution(backend: string) {
  const readiness = await campaignExecutionReadiness(backend);
  if (!readiness.ready) throw new Error(`${readiness.code}: ${readiness.message}`);
  return readiness;
}

export async function dispatchCampaign(input: { campaignId: string; workspaceId: string; projectId: string; backend: string; repository: string; branch: string; repositorySource: RepositorySource; commitSha: string; manifest: WorldModelManifest; plan: CampaignPlan }) {
  const env = await runtime();
  const readiness = evaluateCampaignExecutionReadiness(env, input.backend);
  if (!readiness.ready) throw new Error(`${readiness.code}: ${readiness.message}`);
  const workflow = env.CAMPAIGN_ORCHESTRATOR as WorkflowBinding;
  const instance = await workflow.create({ id: input.campaignId, params: input as unknown as Record<string, unknown> });
  return { workflowId: instance.id, backend: input.backend };
}

export async function dispatchScan(input: { scanId: string; workspaceId: string; projectId: string; repository: string; branch: string; repositorySource: RepositorySource; commitSha?: string }) {
  const env = await runtime();
  const workflow = env.REPOSITORY_SCAN_ORCHESTRATOR as WorkflowBinding | undefined;
  if (!workflow?.create) throw new Error("runner_not_configured: Durable repository scanning is not configured for this deployment");
  const instance = await workflow.create({ id: input.scanId, params: input });
  return { workflowId: instance.id };
}

export async function dispatchRepair(input: { investigationId: string; workspaceId: string; projectId: string; runId: string; objective: string }) {
  const env = await runtime();
  const workflow = env.REPAIR_ORCHESTRATOR as WorkflowBinding | undefined;
  if (!workflow?.create) throw new Error("runner_not_configured: Durable repair execution is not configured for this deployment");
  const instance = await workflow.create({ id: input.investigationId, params: input });
  return { workflowId: instance.id };
}
