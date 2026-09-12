import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStep, loadProtocol } from "../domain/protocol.js";
import { SqliteStore } from "../domain/store.js";
import { validateStep } from "../domain/validate.js";
import { shouldActivate } from "../signals/activation.js";
import { accumulateSignal } from "../signals/accumulate.js";
import { normalizeSlackSignal } from "../signals/normalize.js";
import type { ValidationResult } from "../utils/types.js";
import { demoFixtures, type DemoFixture } from "./fixtures/cases.js";

export type DemoResult = { fixture: DemoFixture; validation: ValidationResult; activation: boolean; observed: Record<string, unknown>; passed: boolean; completionMessageTs?: string };

function matches(fixture: DemoFixture, validation: ValidationResult, activation: boolean): boolean {
  const expected = fixture.expected;
  return validation.complete === expected.complete && activation === expected.activation &&
    (expected.missing === undefined || JSON.stringify(validation.missing) === JSON.stringify(expected.missing)) &&
    (expected.failedField === undefined || validation.failedChecks.some((check) => check.field === expected.failedField)) &&
    (expected.skippedAcceptance === undefined || Boolean(validation.skippedAcceptanceChecks?.length) === expected.skippedAcceptance);
}

export function runFixture(fixture: DemoFixture): DemoResult {
  const directory = mkdtempSync(join(tmpdir(), "commissioning-demo-"));
  const store = new SqliteStore(join(directory, "demo.sqlite"));
  try {
    store.initialize();
    store.seedFromFile(join(process.cwd(), "data/plant-seed.yaml"));
    const protocol = loadProtocol("pv-string-verification");
    const step = getStep(protocol, fixture.stepId);
    const binding = store.listChannelBindings()[0];
    if (!binding) throw new Error("Demo seed has no channel binding");
    let recordId: string | undefined;
    for (const [index, item] of fixture.signals.entries()) {
      const signal = normalizeSlackSignal({ event_id: `${fixture.id}-${index}`, event: { channel: binding.channelId, ts: item.messageTs, text: item.text } });
      const record = accumulateSignal(store, binding, { targetId: fixture.targetId, stepId: fixture.stepId, existingRecordId: recordId }, item.extracted, signal, 20, new Date(`2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`));
      recordId = record.id;
    }
    const record = store.getRecord(recordId!)!;
    const equipment = store.getEquipment(fixture.targetId);
    const validation = validateStep(step, record.observed, { equipment: { serialExpected: equipment?.serialExpected } });
    const activation = shouldActivate(validation);
    return { fixture, validation, activation, observed: record.observed, passed: matches(fixture, validation, activation), completionMessageTs: validation.complete ? record.completionMessageTs : undefined };
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function format(result: DemoResult): string {
  const { fixture, validation } = result;
  const observedLines = Object.keys(result.observed).map((field) => `✓ ${field}`);
  const missingLines = validation.missing.map((field) => `✗ ${field}`);
  const finding = validation.missing.length ? `missing ${validation.missing.join(", ")}` : validation.failedChecks.map((check) => `${check.phase} ${check.field} ${check.check}`).join(", ") || "none";
  return [`CASE ${fixture.id.replace("case", "")} — ${fixture.title}`, "", `Target: ${fixture.targetId}`, `Step: ${fixture.stepId}`, "", "Observed:", ...observedLines, ...missingLines, "", `Validation: ${validation.complete ? "COMPLETE" : "INCOMPLETE"}`, `Activation: ${result.activation ? "YES" : "NO"}`, `Finding: ${finding}`, validation.skippedAcceptanceChecks?.length ? `Skipped acceptance: ${validation.skippedAcceptanceChecks.join(", ")}` : "", result.passed ? "PASS" : "FAIL"].filter(Boolean).join("\n");
}

function main(): void {
  const selected = process.argv[2] ?? "all";
  const fixtures = selected === "all" ? demoFixtures : demoFixtures.filter((fixture) => fixture.id === selected.toLowerCase());
  if (fixtures.length === 0) throw new Error(`Unknown demo case: ${selected}`);
  const results = fixtures.map(runFixture);
  console.log(results.map(format).join("\n\n"));
  const passed = results.filter((result) => result.passed).length;
  console.log(`\n${passed} passed\n${results.length - passed} failed`);
  if (passed !== results.length) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("runner.ts")) main();
