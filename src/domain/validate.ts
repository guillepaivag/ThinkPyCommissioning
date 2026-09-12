import { equals, existsIn, range, resolveExpectedValue } from "../utils/validators.js";
import type { FailedCheck, ObservedValues, ProtocolCheck, ProtocolStep, ValidationContext, ValidationResult } from "../utils/types.js";

function checkFailure(check: ProtocolCheck, observed: ObservedValues, context: ValidationContext): FailedCheck | undefined {
  const value = observed[check.field];
  if (value === undefined) return undefined;
  if (check.type === "range") {
    return range(value, check) ? undefined : { field: check.field, check: "range", phase: check.phase, observed: value, expected: { min: check.min, max: check.max } };
  }
  if (check.type === "exists_in") {
    return existsIn(value, check.allowed_values) ? undefined : { field: check.field, check: "exists_in", phase: check.phase, observed: value, expected: check.allowed_values };
  }
  const expected = check.expected_from ? resolveExpectedValue(check.expected_from, context) : check.expected;
  return equals(value, expected) ? undefined : { field: check.field, check: "equals", phase: check.phase, observed: value, expected };
}

export function validateStep(step: ProtocolStep, observed: ObservedValues, context: ValidationContext): ValidationResult {
  const missing = step.requires.filter((field) => observed[field] === undefined);
  if (missing.length > 0) return { complete: false, missing, failedChecks: [] };
  const conditionFailures = step.checks.filter((check) => check.phase === "condition").map((check) => checkFailure(check, observed, context)).filter((failure): failure is FailedCheck => failure !== undefined);
  if (conditionFailures.length > 0) {
    return { complete: false, missing: [], failedChecks: conditionFailures, skippedAcceptanceChecks: step.checks.filter((check) => check.phase === "acceptance").map((check) => check.field) };
  }
  const acceptanceFailures = step.checks.filter((check) => check.phase === "acceptance").map((check) => checkFailure(check, observed, context)).filter((failure): failure is FailedCheck => failure !== undefined);
  return { complete: acceptanceFailures.length === 0, missing: [], failedChecks: acceptanceFailures };
}
