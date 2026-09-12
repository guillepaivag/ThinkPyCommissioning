import { randomUUID } from "node:crypto";
import { getStep, loadProtocol } from "../domain/protocol.js";
import type { PendingAction, SqliteStore, StoredRecord } from "../domain/store.js";
import { validateStep } from "../domain/validate.js";
import { findingSignature, shouldActivate } from "./activation.js";
import { isInCooldown } from "./cooldown.js";
import type { ValidationResult } from "../utils/types.js";

export type EvaluationEffects = {
  onComplete?: (record: StoredRecord) => Promise<void>;
  onFinding?: (record: StoredRecord, action: PendingAction) => Promise<string | undefined>;
  onResolved?: (record: StoredRecord, action: PendingAction) => Promise<void>;
  // A repeated observation of a finding that is already open is answered again,
  // bound to the existing action instead of creating a duplicate one.
  onRepeated?: (record: StoredRecord, action: PendingAction) => Promise<void>;
};
export type Proposal = (input: { targetId: string; stepName: string; validation: ValidationResult; language: "es" }) => Promise<string>;
export type EvaluationOutcome = { kind: "complete" | "finding" | "cooldown" | "already_pending" | "disabled"; record: StoredRecord; validation: ValidationResult; action?: PendingAction };

export async function evaluateRecord(input: { store: SqliteStore; recordId: string; proposal: Proposal; cooldownMinutes: number; effects?: EvaluationEffects; now?: Date }): Promise<EvaluationOutcome> {
  const record = input.store.getRecord(input.recordId);
  if (!record) throw new Error(`Record not found: ${input.recordId}`);
  const protocolId = input.store.getChannelBinding(record.channelId)?.protocolId;
  if (!protocolId) throw new Error(`No channel binding for ${record.channelId}`);
  const step = getStep(loadProtocol(protocolId), record.stepId);
  const equipment = input.store.getEquipment(record.targetId);
  const validation = validateStep(step, record.observed, { equipment: { serialExpected: equipment?.serialExpected } });
  input.store.markRecordEvaluated(record.id);
  if (!shouldActivate(validation)) {
    input.store.markRecordComplete(record.id);
    const completed = input.store.getRecord(record.id)!;
    const resolved = input.store.resolveOpenActions(record.id);
    for (const action of resolved) await input.effects?.onResolved?.(completed, action);
    await input.effects?.onComplete?.(completed);
    return { kind: "complete", record: completed, validation };
  }
  const binding = input.store.getChannelBinding(record.channelId)!;
  if (!binding.enabled) return { kind: "disabled", record, validation };
  const signature = findingSignature(validation);
  const active = input.store.findActiveAction(record.id, signature);
  if (active) {
    await input.effects?.onRepeated?.(record, active);
    return { kind: "already_pending", record, validation, action: active };
  }
  const now = (input.now ?? new Date()).toISOString();
  const recent = input.store.latestUnresolvedFinding(record.targetId, record.stepId, signature);
  if (recent && isInCooldown(recent.createdAt, now, input.cooldownMinutes)) {
    await input.effects?.onRepeated?.(record, recent);
    return { kind: "cooldown", record, validation, action: recent };
  }
  const proposedMessage = await input.proposal({ targetId: record.targetId, stepName: step.name, validation, language: "es" });
  const action: PendingAction = { id: randomUUID(), recordId: record.id, findingType: signature, finding: validation, status: "pending", proposedMessage, createdAt: now };
  input.store.createPendingAction(action);
  const slackMessageTs = await input.effects?.onFinding?.(record, action);
  if (slackMessageTs) input.store.setPendingActionSlackMessage(action.id, slackMessageTs);
  return { kind: "finding", record, validation, action: input.store.getPendingAction(action.id)! };
}
