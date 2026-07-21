const safeIdPattern = "^[a-z][a-z0-9_-]{1,79}$";
const safeSeedPattern = "^[A-Za-z0-9_.:-]{1,200}$";

export const draftCampaignSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "plan"],
  properties: {
    summary: { type: "string", maxLength: 2_000 },
    plan: {
      type: "object",
      additionalProperties: false,
      required: ["name", "objective", "scenarios", "concurrency", "estimatedMinutes", "assumptions"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 120, pattern: "\\S" },
        objective: { type: "string", minLength: 1, maxLength: 2_000, pattern: "\\S" },
        concurrency: { type: "integer", minimum: 1, maximum: 3 },
        estimatedMinutes: { type: "integer", minimum: 1, maximum: 300 },
        assumptions: {
          type: "array",
          maxItems: 20,
          items: { type: "string", minLength: 1, maxLength: 500, pattern: "\\S" },
        },
        scenarios: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "modelVersionId", "environmentRevisionId", "seed", "durationSeconds", "workload", "faults", "journeyIds", "thresholds", "cleanupPolicy", "evidenceMode"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 100, pattern: "\\S" },
              modelVersionId: { type: "string", pattern: safeIdPattern },
              environmentRevisionId: { type: "string", pattern: safeIdPattern },
              seed: { type: "string", pattern: safeSeedPattern },
              durationSeconds: { type: "integer", minimum: 10, maximum: 900 },
              workload: {
                type: "object",
                additionalProperties: false,
                required: ["baselineRps", "peakMultiplier", "rampSeconds"],
                properties: {
                  baselineRps: { type: "number", minimum: 0, maximum: 10_000 },
                  peakMultiplier: { type: "number", minimum: 1, maximum: 100 },
                  rampSeconds: { type: "integer", minimum: 0, maximum: 900 },
                },
              },
              faults: {
                type: "array",
                maxItems: 8,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["kind", "target", "startOffsetSeconds", "durationSeconds", "latencyMs", "responseCode"],
                  properties: {
                    kind: { type: "string", enum: ["dependency_outage", "database_latency", "traffic_surge"] },
                    target: { type: "string", pattern: safeIdPattern },
                    startOffsetSeconds: { type: "integer", minimum: 0, maximum: 899 },
                    durationSeconds: { type: "integer", minimum: 1, maximum: 900 },
                    latencyMs: { type: ["integer", "null"], minimum: 0, maximum: 120_000 },
                    responseCode: { type: ["integer", "null"], minimum: 100, maximum: 599 },
                  },
                },
              },
              journeyIds: {
                type: "array",
                minItems: 1,
                maxItems: 50,
                items: { type: "string", pattern: safeIdPattern },
              },
              thresholds: {
                type: "object",
                additionalProperties: false,
                required: ["maxErrorRate", "maxP95LatencyMs", "minJourneySuccess"],
                properties: {
                  maxErrorRate: { type: "number", minimum: 0, maximum: 100 },
                  maxP95LatencyMs: { type: "integer", minimum: 1, maximum: 120_000 },
                  minJourneySuccess: { type: "number", minimum: 0, maximum: 100 },
                },
              },
              cleanupPolicy: { type: "string", enum: ["always"] },
              evidenceMode: { type: "string", enum: ["observed"] },
            },
          },
        },
      },
    },
  },
} as const;
