import { resolve } from "node:path";
import { z } from "zod";
import { readYaml } from "../utils/yaml.js";
import type { Protocol, ProtocolStep } from "../utils/types.js";

const phase = z.enum(["condition", "acceptance"]);
const check = z.discriminatedUnion("type", [
  z.object({ type: z.literal("range"), field: z.string(), min: z.number().optional(), max: z.number().optional(), phase }),
  z.object({ type: z.literal("equals"), field: z.string(), expected: z.union([z.string(), z.number(), z.boolean()]).optional(), expected_from: z.literal("equipment.serial_expected").optional(), phase }),
  z.object({ type: z.literal("exists_in"), field: z.string(), allowed_values: z.array(z.union([z.string(), z.number(), z.boolean()])), phase })
]);

const protocolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  steps: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), target_type: z.string().min(1),
    requires: z.array(z.string()).min(1),
    fields: z.record(z.string(), z.object({ type: z.enum(["number", "string", "boolean"]), unit: z.string().optional() })),
    checks: z.array(check)
  })).min(1)
});

export function loadProtocol(protocolId: string, baseDir = process.cwd()): Protocol {
  const path = resolve(baseDir, "data/protocols", `${protocolId}.yaml`);
  return protocolSchema.parse(readYaml(path)) as Protocol;
}

export function getStep(protocol: Protocol, stepId: string): ProtocolStep {
  const step = protocol.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`Protocol step not found: ${stepId}`);
  return step;
}
