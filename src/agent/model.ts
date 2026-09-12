import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import type { z } from "zod";

export type ModelImage = { base64: string; mimeType: string };
export type ObjectGenerator = <T extends z.ZodType>(args: { modelName: string; schema: T; prompt: string; system?: string; images?: ModelImage[] }) => Promise<z.infer<T>>;
export type ModelProviderName = "openrouter" | "openai";

function modelName(variable: string): string {
  const value = process.env[variable];
  if (!value) throw new Error(`Missing required model configuration: ${variable}`);
  return value;
}

export function selectModelProvider(env: NodeJS.ProcessEnv = process.env): ModelProviderName {
  const requested = env.AI_PROVIDER;
  const keyByProvider = { openrouter: env.OPENROUTER_API_KEY, openai: env.OPENAI_API_KEY } as const;
  if (requested === "openrouter" || requested === "openai") {
    if (!keyByProvider[requested]) throw new Error(`Missing model provider credential: ${requested === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"}`);
    return requested;
  }
  if (requested) throw new Error("AI_PROVIDER must be one of: openrouter, openai");
  if (env.OPENROUTER_API_KEY) return "openrouter";
  if (env.OPENAI_API_KEY) return "openai";
  throw new Error("Missing model provider credential: OPENROUTER_API_KEY or OPENAI_API_KEY");
}

export const vercelObjectGenerator: ObjectGenerator = async ({ modelName: configuredModel, schema, prompt, system, images }) => {
  const selected = selectModelProvider();
  const model = selected === "openrouter"
    ? createOpenAI({ apiKey: process.env.OPENROUTER_API_KEY!, baseURL: "https://openrouter.ai/api/v1" })(configuredModel)
    : createOpenAI({ apiKey: process.env.OPENAI_API_KEY! })(configuredModel);
  const result = images?.length
    ? await generateObject({
        model, schema, system,
        // A serial read needs few output tokens; an unbounded request exceeds
        // the provider's output-tokens-per-minute limit on the on-demand tier.
        maxOutputTokens: 700,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...images.map((image) => ({ type: "file" as const, data: image.base64, mediaType: image.mimeType }))] }]
      })
    : await generateObject({ model, schema, prompt, system });
  return result.object as z.infer<typeof schema>;
};

export function configuredModel(variable: "CLASSIFICATION_MODEL" | "EXTRACTION_MODEL" | "PROPOSAL_MODEL" | "VISION_MODEL" | "FALLBACK_MODEL"): string {
  return modelName(variable);
}
