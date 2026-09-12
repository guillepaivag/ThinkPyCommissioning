import { z } from "zod";
import { configuredModel, type ModelImage, type ObjectGenerator, vercelObjectGenerator } from "./model.js";
import type { ObservedValues, ProtocolStep } from "../utils/types.js";

// Strict structured output (Groq, OpenAI) requires every property to be listed as
// required, so absence is expressed as null and stripped below rather than by
// omitting optional keys.
function schemaFor(step: ProtocolStep): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [field, definition] of Object.entries(step.fields)) {
    const type = definition.type === "number" ? z.number() : definition.type === "boolean" ? z.boolean() : z.string();
    shape[field] = type.nullable();
  }
  return z.object(shape).strict();
}

function stripAbsent(raw: Record<string, unknown>): ObservedValues {
  const observed: ObservedValues = {};
  for (const [field, value] of Object.entries(raw)) if (value !== null && value !== undefined) observed[field] = value as ObservedValues[string];
  return observed;
}

const RULES = "Extrae solo valores explícitamente observables. Devuelve null en todo campo que no aparezca; nunca inventes ni estimes mediciones. El identificador del string o del equipo (por ejemplo STR-03-01 o INV-03) identifica el objeto ensayado y nunca es el valor de un campo.";

export async function extractObservation(
  text: string | undefined,
  step: ProtocolStep,
  generator: ObjectGenerator = vercelObjectGenerator,
  images: ModelImage[] = []
): Promise<ObservedValues> {
  // A photograph is read by the vision model; unreadable evidence must yield an
  // absent field rather than a guessed value.
  const raw = await generator({
    modelName: configuredModel(images.length ? "VISION_MODEL" : "EXTRACTION_MODEL"), schema: schemaFor(step),
    system: images.length ? `${RULES} Lee los valores de la fotografía. Si un dato no se lee con claridad, devuelve null y no lo estimes.` : RULES,
    prompt: JSON.stringify({ text: text ?? "", fields: step.fields }),
    images
  });
  return stripAbsent(raw as Record<string, unknown>);
}
