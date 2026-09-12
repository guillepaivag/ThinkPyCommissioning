import { z } from "zod";
import { configuredModel, type ObjectGenerator, vercelObjectGenerator } from "./model.js";
import type { ValidationResult } from "../utils/types.js";

const schema = z.object({ message: z.string().min(1).max(600) });

export async function proposeFinding(
  input: { targetId: string; stepName: string; validation: ValidationResult; language: "es" },
  generator: ObjectGenerator = vercelObjectGenerator
): Promise<string> {
  const result = await generator({
    modelName: configuredModel("PROPOSAL_MODEL"), schema,
    system: "Redacta un único aviso breve en español. No alteres el hallazgo determinista, no agregues hallazgos ni infieras valores.",
    prompt: JSON.stringify(input)
  });
  return result.message;
}
