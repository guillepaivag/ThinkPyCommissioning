import { describe, expect, it } from "vitest";
import { demoFixtures } from "./fixtures/cases.js";
import { runFixture } from "./runner.js";

describe("CLI demo fixtures", () => {
  it("runs all nine cases through production domain and signal layers", () => {
    const results = demoFixtures.map(runFixture);
    expect(results).toHaveLength(9);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.find((result) => result.fixture.id === "case8")?.completionMessageTs).toBe("8.003");
  });
});
