import { classifySignal, associateSingleOpenRecord, type Classification, type OpenRecordCandidate } from "./agent/classify.js";
import { extractObservation } from "./agent/extract.js";
import type { ModelImage } from "./agent/model.js";
import { getStep, loadProtocol } from "./domain/protocol.js";
import type { SqliteStore, StoredRecord } from "./domain/store.js";
import { validateStep } from "./domain/validate.js";
import { accumulateSignal } from "./signals/accumulate.js";
import type { EvaluationScheduler } from "./signals/scheduler.js";
import type { NormalizedSignal, ObservedValues, ProtocolStep } from "./utils/types.js";

type Classifier = (input: { text?: string; targetIds: string[]; stepIds: string[]; candidates: OpenRecordCandidate[]; images?: ModelImage[] }) => Promise<Classification>;
type Extractor = (text: string | undefined, step: ProtocolStep, generator?: unknown, images?: ModelImage[]) => Promise<ObservedValues>;

export type IngestOutcome = { recordId?: string; ignored?: string; stepName?: string; unreadableFields?: string[] };

export class CommissioningService {
  constructor(private readonly input: { store: SqliteStore; scheduler: EvaluationScheduler; delaySeconds: number; classify?: Classifier; extract?: Extractor }) {}

  async ingest(signal: NormalizedSignal): Promise<IngestOutcome> {
    if (!this.input.store.markEventProcessed(signal.eventId, signal.channelId, signal.messageTs)) return { ignored: "duplicate" };
    const binding = this.input.store.getChannelBinding(signal.channelId);
    if (!binding) return { ignored: "unbound_channel" };
    const protocol = loadProtocol(binding.protocolId);
    const equipment = this.input.store.listEquipmentByBlock(binding.blockId);
    const candidates = this.openCandidates(signal.channelId, protocol);
    const baseExtract = this.input.extract ?? extractObservation;
    const images: ModelImage[] = (signal.files ?? []).flatMap((file) => file.base64 && file.mimeType?.startsWith("image/") ? [{ base64: file.base64, mimeType: file.mimeType }] : []);
    // Fail closed: a shared file whose bytes could not be obtained carries no
    // observable evidence, so it must not be classified from an empty message
    // and attached to whichever record happens to be open.
    if (signal.files?.length && !signal.text?.trim() && !images.length) return { ignored: "evidence_unavailable" };
    const extract = (text: string | undefined, step: ProtocolStep) => baseExtract(text, step, undefined, images);
    // A continuation message may name neither the target nor the step, so the
    // observation is extracted once per open step and a candidate is associated
    // only when exactly one of them gains a field it was missing. More than one
    // match is ambiguous and is left to the classifier rather than guessed.
    // A photograph is read by a rate-limited vision model, so it is never read
    // speculatively once per open step: the step is resolved first and the image
    // is read exactly once, against that step.
    const byStep = new Map<string, ObservedValues>();
    if (!images.length) {
      for (const stepId of new Set(candidates.map((candidate) => candidate.stepId))) {
        byStep.set(stepId, await extract(signal.text, getStep(protocol, stepId)));
      }
    }
    const matches = candidates.filter((candidate) => candidate.missingFields.some((field) => byStep.get(candidate.stepId)?.[field] !== undefined));
    let identity: Classification | undefined = matches.length === 1 ? associateSingleOpenRecord(matches, byStep.get(matches[0].stepId) ?? {}) : undefined;
    if (!identity) identity = await (this.input.classify ?? classifySignal)({ text: signal.text, targetIds: equipment.map((item) => item.id), stepIds: protocol.steps.map((step) => step.id), candidates, images });
    if (!identity.relevant || !identity.targetId || !identity.stepId) return images.length ? imageNotMatching(binding) : { ignored: "irrelevant_or_ambiguous" };
    const target = equipment.find((item) => item.id === identity.targetId);
    const step = getStep(protocol, identity.stepId);
    if (!target || target.type !== step.target_type) return images.length ? imageNotMatching(binding) : { ignored: "invalid_protocol_context" };
    // Always extract against the step that was actually resolved: a speculative
    // extraction made for a different step must never be reused.
    const extracted = byStep.get(step.id) ?? await extract(signal.text, step);
    // An image that yields no observable value (blurred, or unrelated to the work)
    // does not match the evidence the step expects. It is reported to the
    // technician and never merged into a record as empty evidence.
    if (images.length && Object.keys(extracted).length === 0) return imageNotMatching(binding, step);
    const record = accumulateSignal(this.input.store, binding, { targetId: identity.targetId, stepId: identity.stepId, existingRecordId: identity.existingRecordId }, extracted, signal, this.input.delaySeconds);
    this.input.scheduler.schedule(record);
    return { recordId: record.id };
  }

  private openCandidates(channelId: string, protocol: ReturnType<typeof loadProtocol>): OpenRecordCandidate[] {
    return this.input.store.listOpenRecords(channelId).flatMap((record): OpenRecordCandidate[] => {
      const step = protocol.steps.find((candidate) => candidate.id === record.stepId);
      if (!step) return [];
      const equipment = this.input.store.getEquipment(record.targetId);
      const validation = validateStep(step, record.observed, { equipment: { serialExpected: equipment?.serialExpected } });
      return [{ recordId: record.id, targetId: record.targetId, stepId: record.stepId, lastObservationAt: record.lastObservationAt, missingFields: validation.missing }];
    });
  }
}

function imageNotMatching(binding: { enabled: boolean }, step?: ProtocolStep): IngestOutcome {
  if (!binding.enabled) return { ignored: "disabled" };
  return { ignored: "image_not_matching", stepName: step?.name, unreadableFields: step?.requires };
}
