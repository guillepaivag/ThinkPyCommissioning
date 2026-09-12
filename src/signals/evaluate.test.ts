import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SqliteStore } from "../domain/store.js";
import { accumulateSignal } from "./accumulate.js";
import { evaluateRecord } from "./evaluate.js";
import { EvaluationScheduler } from "./scheduler.js";

function setup(values: Record<string, string | number>) {
  const folder = mkdtempSync(join(tmpdir(), "commissioning-eval-")); const store = new SqliteStore(join(folder, "state.sqlite"));
  store.initialize(); store.seedFromFile(join(process.cwd(), "data/plant-seed.yaml"));
  const binding = store.listChannelBindings()[0]!;
  const record = accumulateSignal(store, binding, { targetId: "STR-03-01", stepId: "voc" }, values, { eventId: "e", channelId: binding.channelId, messageTs: "1.1" }, 1, new Date("2026-01-01T00:00:00Z"));
  return { folder, store, record };
}

describe("persistent evaluation", () => {
  it("answers a repeated finding again, bound to the existing action", async () => {
    const { folder, store, record } = setup({ voc_v: 842, module_temp_c: 47, instrument: "SMFT-1000" });
    const proposal = vi.fn().mockResolvedValue("Falta irradiancia.");
    const onRepeated = vi.fn().mockResolvedValue(undefined);
    const first = await evaluateRecord({ store, recordId: record.id, proposal, cooldownMinutes: 30, effects: { onRepeated }, now: new Date("2026-01-01T00:00:02Z") });
    expect(onRepeated).not.toHaveBeenCalled();
    const again = await evaluateRecord({ store, recordId: record.id, proposal, cooldownMinutes: 30, effects: { onRepeated }, now: new Date("2026-01-01T00:00:03Z") });
    expect(again.kind).toBe("already_pending");
    expect(onRepeated).toHaveBeenCalledTimes(1);
    expect(onRepeated.mock.calls[0][1].id).toBe(first.action!.id);
    expect(proposal).toHaveBeenCalledTimes(1);
    store.close(); rmSync(folder, { recursive: true, force: true });
  });

  it("creates one proposed finding and honors cooldown", async () => {
    const { folder, store, record } = setup({ voc_v: 842, module_temp_c: 47, instrument: "SMFT-1000" });
    const proposal = vi.fn().mockResolvedValue("Falta irradiancia.");
    const first = await evaluateRecord({ store, recordId: record.id, proposal, cooldownMinutes: 30, now: new Date("2026-01-01T00:00:02Z") });
    expect(first.kind).toBe("finding");
    const again = await evaluateRecord({ store, recordId: record.id, proposal, cooldownMinutes: 30, now: new Date("2026-01-01T00:00:03Z") });
    expect(again.kind).toBe("already_pending"); expect(proposal).toHaveBeenCalledTimes(1);
    store.close(); rmSync(folder, { recursive: true, force: true });
  });

  it("resolves an open finding when late evidence makes the record complete", async () => {
    const { folder, store, record } = setup({ voc_v: 842, module_temp_c: 47, instrument: "SMFT-1000" });
    await evaluateRecord({ store, recordId: record.id, proposal: async () => "Falta irradiancia.", cooldownMinutes: 30 });
    store.mergeObservation(record.id, { irradiance_w_m2: 940 }, "1.2", new Date().toISOString());
    const resolved = vi.fn();
    const outcome = await evaluateRecord({ store, recordId: record.id, proposal: async () => "unused", cooldownMinutes: 30, effects: { onResolved: resolved } });
    expect(outcome.kind).toBe("complete"); expect(resolved).toHaveBeenCalledTimes(1);
    expect(store.getPendingAction((store.db.prepare("SELECT id FROM pending_actions").get() as { id: string }).id)?.status).toBe("resolved");
    store.close(); rmSync(folder, { recursive: true, force: true });
  });

  it("respects the channel kill switch", async () => {
    const { folder, store, record } = setup({ voc_v: 842 });
    store.db.prepare("UPDATE channel_bindings SET enabled = 0 WHERE channel_id = ?").run(store.listChannelBindings()[0]!.channelId);
    const outcome = await evaluateRecord({ store, recordId: record.id, proposal: async () => "unused", cooldownMinutes: 30 });
    expect(outcome.kind).toBe("disabled");
    store.close(); rmSync(folder, { recursive: true, force: true });
  });

  it("preserves an approved audit action when evidence later corrects its record", async () => {
    const { folder, store, record } = setup({ voc_v: 842, module_temp_c: 47, instrument: "SMFT-1000" });
    const finding = await evaluateRecord({ store, recordId: record.id, proposal: async () => "Falta irradiancia.", cooldownMinutes: 30 });
    store.approvePendingAction(finding.action!.id, "supervisor");
    store.mergeObservation(record.id, { irradiance_w_m2: 940 }, "1.2", new Date().toISOString());
    await evaluateRecord({ store, recordId: record.id, proposal: async () => "unused", cooldownMinutes: 30 });
    const action = store.getPendingAction(finding.action!.id)!;
    expect(action.status).toBe("approved"); expect(action.resolvedAt).toBeDefined();
    store.close(); rmSync(folder, { recursive: true, force: true });
  });

  it("recovers overdue evaluations after a SQLite reopen", async () => {
    const { folder, store, record } = setup({ voc_v: 842 });
    store.mergeObservation(record.id, {}, "1.1", "2025-01-01T00:00:00.000Z");
    const path = join(folder, "state.sqlite"); store.close();
    const reopened = new SqliteStore(path); reopened.initialize();
    const scheduler = new EvaluationScheduler({ store: reopened, proposal: async () => "Falta información.", cooldownMinutes: 30 });
    await scheduler.recoverOverdue();
    expect(reopened.db.prepare("SELECT count(*) AS count FROM pending_actions").get()).toMatchObject({ count: 1 });
    scheduler.stop(); reopened.close(); rmSync(folder, { recursive: true, force: true });
  });
});
