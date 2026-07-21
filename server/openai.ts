import type { CampaignPlan } from "@/worldmodel/product-contracts";
import { validateCampaign } from "@/worldmodel/product-contracts";
import { effectiveRuntimeEnvironment } from "./runtime-config.ts";

type RuntimeEnvironment = Record<string, string | undefined>;

async function configuration() {
  const values = await effectiveRuntimeEnvironment() as RuntimeEnvironment;
  const apiKey = values.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("ai_not_configured: The project assistant is unavailable until OPENAI_API_KEY is configured");
  return { apiKey, model: values.OPENAI_AGENT_MODEL?.trim() || "gpt-5.6", storeResponses: values.OPENAI_STORE_RESPONSES === "true" };
}

export async function draftCampaignWithOpenAI(input: { message: string; project: Record<string, unknown>; model: Record<string, unknown> | null; environment: Record<string, unknown> | null; journeys: Array<Record<string, unknown>>; previousResponseId?: string | null }): Promise<{ responseId: string; model: string; plan: CampaignPlan; summary: string; usage: Record<string, unknown>; toolCall: { id: string; name: string; arguments: string } }> {
  const config = await configuration();
  const schema = {
    type: "object", additionalProperties: false, required: ["summary", "plan"],
    properties: {
      summary: { type: "string" },
      plan: {
        type: "object", additionalProperties: false,
        required: ["name", "objective", "scenarios", "concurrency", "estimatedMinutes", "assumptions"],
        properties: {
          name: { type: "string" }, objective: { type: "string" },
          concurrency: { type: "integer", minimum: 1, maximum: 3 }, estimatedMinutes: { type: "integer" },
          assumptions: { type: "array", items: { type: "string" }, maxItems: 20 },
          scenarios: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, required: ["name", "modelVersionId", "environmentRevisionId", "seed", "durationSeconds", "workload", "faults", "journeyIds", "thresholds", "cleanupPolicy", "evidenceMode"], properties: {
            name: { type: "string" }, modelVersionId: { type: "string" }, environmentRevisionId: { type: "string" }, seed: { type: "string" }, durationSeconds: { type: "integer", minimum: 10, maximum: 900 },
            workload: { type: "object", additionalProperties: false, required: ["baselineRps", "peakMultiplier", "rampSeconds"], properties: { baselineRps: { type: "number", minimum: 0 }, peakMultiplier: { type: "number", minimum: 1 }, rampSeconds: { type: "integer", minimum: 0 } } },
            faults: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["kind", "target", "startOffsetSeconds", "durationSeconds", "latencyMs", "responseCode"], properties: { kind: { type: "string", enum: ["dependency_outage", "database_latency", "traffic_surge"] }, target: { type: "string" }, startOffsetSeconds: { type: "integer", minimum: 0 }, durationSeconds: { type: "integer", minimum: 1 }, latencyMs: { type: ["integer", "null"] }, responseCode: { type: ["integer", "null"] } } } },
            journeyIds: { type: "array", minItems: 1, items: { type: "string" } }, thresholds: { type: "object", additionalProperties: false, required: ["maxErrorRate", "maxP95LatencyMs", "minJourneySuccess"], properties: { maxErrorRate: { type: "number" }, maxP95LatencyMs: { type: "integer" }, minJourneySuccess: { type: "number" } } }, cleanupPolicy: { type: "string", enum: ["always"] }, evidenceMode: { type: "string", enum: ["observed"] },
          } } },
        },
      },
    },
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      store: config.storeResponses,
      previous_response_id: config.storeResponses ? input.previousResponseId || undefined : undefined,
      input: [{ role: "developer", content: [{ type: "input_text", text: "You are the WorldModel Scenario Copilot. Produce only a bounded, evidence-aware campaign. Never claim a run happened. Use only supplied model node IDs, environment revision, and journey IDs. Maximum 20 scenarios and concurrency 3." }] }, { role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] }],
      tools: [{ type: "function", name: "draft_campaign", description: "Return an editable, bounded reliability campaign for deterministic server validation.", strict: true, parameters: schema }],
      tool_choice: { type: "function", name: "draft_campaign" },
      parallel_tool_calls: false,
    }),
  });
  const payload = await response.json() as { id?: string; model?: string; output?: Array<{ type?: string; call_id?: string; name?: string; arguments?: string }>; usage?: Record<string, unknown>; error?: { message?: string } };
  if (!response.ok || !payload.id) throw new Error(`ai_request_failed: ${payload.error?.message || `OpenAI returned ${response.status}`}`);
  const call = payload.output?.find((item) => item.type === "function_call" && item.name === "draft_campaign");
  const text = call?.arguments;
  if (!text || !call?.call_id) throw new Error("ai_output_invalid: The assistant returned no draft_campaign tool call");
  let decoded: { summary?: string; plan?: unknown };
  try { decoded = JSON.parse(text); } catch { throw new Error("ai_output_invalid: The assistant response was not valid JSON"); }
  const plan = validateCampaign(decoded.plan);
  return { responseId: payload.id, model: payload.model || config.model, plan, summary: decoded.summary?.slice(0, 2000) || "Campaign ready for review", usage: payload.usage || {}, toolCall: { id: call.call_id, name: "draft_campaign", arguments: text } };
}
