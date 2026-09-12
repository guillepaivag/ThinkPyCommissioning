import type { SqliteStore, StoredRecord } from "../domain/store.js";
import { evaluateRecord, type EvaluationEffects, type EvaluationOutcome, type Proposal } from "./evaluate.js";

export class EvaluationScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private sweepTimer?: NodeJS.Timeout;
  constructor(private readonly input: {
    store: SqliteStore; proposal: Proposal; cooldownMinutes: number; effects?: EvaluationEffects; logger?: (entry: object) => void;
    onEvaluated?: (recordId: string, outcome: EvaluationOutcome) => Promise<void>;
    onEvaluationFailed?: (recordId: string, error: unknown) => Promise<void>;
  }) {}

  schedule(record: StoredRecord): void {
    const existing = this.timers.get(record.id);
    if (existing) clearTimeout(existing);
    const delay = Math.max(0, new Date(record.evaluationDueAt).getTime() - Date.now());
    const timer = setTimeout(() => void this.evaluate(record.id), delay);
    this.timers.set(record.id, timer);
  }

  async recoverOverdue(): Promise<void> {
    for (const record of this.input.store.listOverdueRecords(new Date().toISOString())) await this.evaluate(record.id);
  }

  start(): void {
    void this.recoverOverdue();
    this.sweepTimer = setInterval(() => void this.recoverOverdue(), 15_000);
    this.sweepTimer.unref();
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  private async evaluate(recordId: string): Promise<void> {
    this.timers.delete(recordId);
    try {
      const outcome = await evaluateRecord({ ...this.input, recordId });
      this.input.logger?.({ level: "info", event: "record_evaluated", recordId, outcome: outcome.kind });
      await this.input.onEvaluated?.(recordId, outcome);
    } catch (error) {
      this.input.logger?.({ level: "error", event: "record_evaluation_failed", recordId, error: error instanceof Error ? error.message : String(error) });
      await this.input.onEvaluationFailed?.(recordId, error);
    }
  }
}
