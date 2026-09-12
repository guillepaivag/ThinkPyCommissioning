export type FieldValue = string | number | boolean;
export type ObservedValues = Record<string, FieldValue | undefined>;

export type CheckPhase = "condition" | "acceptance";

export type RangeCheck = {
  type: "range";
  field: string;
  min?: number;
  max?: number;
  phase: CheckPhase;
};

export type EqualsCheck = {
  type: "equals";
  field: string;
  expected?: FieldValue;
  expected_from?: "equipment.serial_expected";
  phase: CheckPhase;
};

export type ExistsInCheck = {
  type: "exists_in";
  field: string;
  allowed_values: FieldValue[];
  phase: CheckPhase;
};

export type ProtocolCheck = RangeCheck | EqualsCheck | ExistsInCheck;

export type ProtocolField = { type: "number" | "string" | "boolean"; unit?: string };

export type ProtocolStep = {
  id: string;
  name: string;
  target_type: string;
  requires: string[];
  fields: Record<string, ProtocolField>;
  checks: ProtocolCheck[];
};

export type Protocol = { id: string; name: string; steps: ProtocolStep[] };

export type ValidationContext = {
  equipment?: { serialExpected?: string };
};

export type FailedCheck = {
  field: string;
  check: "exists_in" | "range" | "equals";
  phase: CheckPhase;
  observed?: FieldValue;
  expected?: unknown;
};

export type ValidationResult = {
  complete: boolean;
  missing: string[];
  failedChecks: FailedCheck[];
  skippedAcceptanceChecks?: string[];
};

export type NormalizedSignal = {
  eventId: string;
  channelId: string;
  messageTs: string;
  userId?: string;
  text?: string;
  files?: { id: string; mimeType?: string; url?: string; name?: string; base64?: string }[];
};
