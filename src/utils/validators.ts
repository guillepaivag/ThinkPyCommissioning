import type { FieldValue, ProtocolCheck, ValidationContext } from "./types.js";

export function range(value: unknown, limits: { min?: number; max?: number }): boolean {
  return typeof value === "number" && (limits.min === undefined || value >= limits.min) && (limits.max === undefined || value <= limits.max);
}

export function equals(value: unknown, expected: unknown): boolean {
  return value === expected;
}

export function existsIn(value: unknown, allowedValues: FieldValue[]): boolean {
  return allowedValues.includes(value as FieldValue);
}

export function resolveExpectedValue(key: NonNullable<Extract<ProtocolCheck, { type: "equals" }> ["expected_from"]>, context: ValidationContext): unknown {
  switch (key) {
    case "equipment.serial_expected": return context.equipment?.serialExpected;
  }
}
