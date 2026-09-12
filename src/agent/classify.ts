import { z } from "zod";
import { configuredModel, type ModelImage, type ObjectGenerator, vercelObjectGenerator } from "./model.js";

export type OpenRecordCandidate = { recordId: string; targetId: string; stepId: string; lastObservationAt: string; missingFields: string[] };
export type Classification = { relevant: boolean; targetId?: string; stepId?: string; existingRecordId?: string };

// Strict structured output requires every property to be required, so "no value"
// is expressed as null and normalised back to undefined below.
const schema = z.object({ relevant: z.boolean(), targetId: z.string().nullable(), stepId: z.string().nullable(), existingRecordId: z.string().nullable() });

export async function classifySignal(
  input: { text?: string; targetIds: string[]; stepIds: string[]; candidates: OpenRecordCandidate[]; images?: ModelImage[] },
  generator: ObjectGenerator = vercelObjectGenerator
): Promise<Classification> {
  const images = input.images ?? [];
  // A photograph often carries its own identification (a label such as
  // "Placa INV-03", or the equipment it shows), so it is classified by looking
  // at it rather than at an empty message.
  const raw = await generator({
    modelName: configuredModel(images.length ? "VISION_MODEL" : "CLASSIFICATION_MODEL"), schema, images,
    system: "Clasifica únicamente actividad de commissioning. Usa solo identificadores de las listas permitidas. No inventes objetivos, pasos ni asociaciones. Devuelve null en los campos que no correspondan." + (images.length ? " Hay una fotografía: identifica el equipo y el ensayo por lo que muestra y por cualquier etiqueta visible. Una foto de una placa de características corresponde al inversor, no a una medición de string." : ""),
    prompt: JSON.stringify({ signalText: input.text ?? "", allowedTargetIds: input.targetIds, allowedStepIds: input.stepIds, recentOpenCandidates: input.candidates })
  });
  if (!raw.relevant || !raw.targetId || !raw.stepId) return { relevant: false };
  return { relevant: true, targetId: raw.targetId, stepId: raw.stepId, existingRecordId: raw.existingRecordId ?? undefined };
}

export function associateSingleOpenRecord(candidates: OpenRecordCandidate[], extractedFields: Record<string, unknown>): Classification | undefined {
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0];
  if (!candidate.missingFields.some((field) => extractedFields[field] !== undefined)) return undefined;
  return { relevant: true, targetId: candidate.targetId, stepId: candidate.stepId, existingRecordId: candidate.recordId };
}
