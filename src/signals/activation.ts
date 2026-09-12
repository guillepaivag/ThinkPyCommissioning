import type { ValidationResult } from "../utils/types.js";

export function shouldActivate(validation: ValidationResult): boolean {
  return validation.missing.length > 0 || validation.failedChecks.length > 0;
}

export function findingSignature(validation: ValidationResult): string {
  return JSON.stringify({
    missing: [...validation.missing].sort(),
    failedChecks: validation.failedChecks.map(({ field, check, phase, expected }) => ({ field, check, phase, expected }))
  });
}
