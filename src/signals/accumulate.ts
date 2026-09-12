import { randomUUID } from "node:crypto";
import type { SqliteStore, StoredRecord } from "../domain/store.js";
import type { NormalizedSignal, ObservedValues } from "../utils/types.js";

export type ObservationIdentity = { targetId: string; stepId: string; existingRecordId?: string };

export function accumulateSignal(
  store: SqliteStore,
  binding: { blockId: string },
  identity: ObservationIdentity,
  extracted: ObservedValues,
  signal: NormalizedSignal,
  delaySeconds: number,
  now = new Date()
): StoredRecord {
  const dueAt = new Date(now.getTime() + delaySeconds * 1_000).toISOString();
  const existing = identity.existingRecordId ? store.getRecord(identity.existingRecordId) : store.findOpenRecord(signal.channelId, identity.targetId, identity.stepId);
  if (existing) return store.mergeObservation(existing.id, extracted, signal.messageTs, dueAt, now.toISOString());
  const record: StoredRecord = {
    id: randomUUID(), channelId: signal.channelId, blockId: binding.blockId, targetId: identity.targetId, stepId: identity.stepId,
    status: "open", observed: extracted, lastObservationAt: now.toISOString(), evaluationDueAt: dueAt,
    evaluationStatus: "pending_evaluation", completionMessageTs: signal.messageTs
  };
  store.createRecord(record, now.toISOString());
  return record;
}
