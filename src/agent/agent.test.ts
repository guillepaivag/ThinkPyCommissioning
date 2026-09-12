import { describe, expect, it, vi } from "vitest";
import { associateSingleOpenRecord } from "./classify.js";
import { extractObservation } from "./extract.js";
import { selectModelProvider } from "./model.js";
import { getStep, loadProtocol } from "../domain/protocol.js";

describe("model narrow waist", () => {
  it("associates a continuation only when exactly one candidate gains a missing field", () => {
    const candidates = [{ recordId: "r1", targetId: "T1", stepId: "S1", lastObservationAt: "now", missingFields: ["needed"] }];
    expect(associateSingleOpenRecord(candidates, { needed: 1 })).toMatchObject({ existingRecordId: "r1" });
    expect(associateSingleOpenRecord(candidates, { other: 1 })).toBeUndefined();
    expect(associateSingleOpenRecord([...candidates, { ...candidates[0], recordId: "r2" }], { needed: 1 })).toBeUndefined();
  });

  it("derives extraction output shape from the protocol step", async () => {
    process.env.EXTRACTION_MODEL = "fixture";
    const generator = vi.fn().mockResolvedValue({ voc_v: 842 });
    const values = await extractObservation("reading", getStep(loadProtocol("pv-string-verification"), "voc"), generator);
    expect(values).toEqual({ voc_v: 842 });
    expect(generator.mock.calls[0][0].schema.safeParse({ notInProtocol: 1 }).success).toBe(false);
  });

  it("selects Groq while preserving OpenRouter and OpenAI", () => {
    expect(selectModelProvider({ AI_PROVIDER: "groq", GROQ_API_KEY: "key" })).toBe("groq");
    expect(selectModelProvider({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "key" })).toBe("openrouter");
    expect(selectModelProvider({ AI_PROVIDER: "openai", OPENAI_API_KEY: "key" })).toBe("openai");
  });
});
