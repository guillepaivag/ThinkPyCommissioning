import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CommissioningService } from "./app.js";
import { SqliteStore } from "./domain/store.js";
import { EvaluationScheduler } from "./signals/scheduler.js";

describe("CommissioningService", () => {
  it("deduplicates events and schedules a classified protocol observation", async () => {
    const folder = mkdtempSync(join(tmpdir(), "commissioning-app-")); const store = new SqliteStore(join(folder, "state.sqlite"));
    store.initialize(); store.seedFromFile(join(process.cwd(), "data/plant-seed.yaml"));
    const scheduler = new EvaluationScheduler({ store, proposal: async () => "unused", cooldownMinutes: 30 });
    const classify = vi.fn().mockResolvedValue({ relevant: true, targetId: "STR-03-01", stepId: "voc" });
    const extract = vi.fn().mockResolvedValue({ voc_v: 842, irradiance_w_m2: 940, module_temp_c: 47, instrument: "SMFT-1000" });
    const service = new CommissioningService({ store, scheduler, delaySeconds: 3600, classify, extract });
    const signal = { eventId: "event-1", channelId: store.listChannelBindings()[0]!.channelId, messageTs: "1.0", text: "lectura" };
    const first = await service.ingest(signal);
    expect(first.recordId).toBeDefined(); expect(classify).toHaveBeenCalledTimes(1);
    expect(await service.ingest(signal)).toEqual({ ignored: "duplicate" });
    expect(classify).toHaveBeenCalledTimes(1);
    scheduler.stop(); store.close(); rmSync(folder, { recursive: true, force: true });
  });

  it("ignores a shared file whose image could not be obtained without consulting any model", async () => {
    const folder = mkdtempSync(join(tmpdir(), "commissioning-app-")); const store = new SqliteStore(join(folder, "state.sqlite"));
    store.initialize(); store.seedFromFile(join(process.cwd(), "data/plant-seed.yaml"));
    const scheduler = new EvaluationScheduler({ store, proposal: async () => "unused", cooldownMinutes: 30 });
    const classify = vi.fn(); const extract = vi.fn();
    const service = new CommissioningService({ store, scheduler, delaySeconds: 3600, classify, extract });
    const signal = { eventId: "event-photo", channelId: store.listChannelBindings()[0]!.channelId, messageTs: "2.0", text: "", files: [{ id: "F1", mimeType: "image/png", url: "https://files.slack.com/x" }] };
    expect(await service.ingest(signal)).toEqual({ ignored: "evidence_unavailable" });
    expect(classify).not.toHaveBeenCalled(); expect(extract).not.toHaveBeenCalled();
    scheduler.stop(); store.close(); rmSync(folder, { recursive: true, force: true });
  });

  it("reports an image that yields no readable value instead of merging empty evidence", async () => {
    const folder = mkdtempSync(join(tmpdir(), "commissioning-app-")); const store = new SqliteStore(join(folder, "state.sqlite"));
    store.initialize(); store.seedFromFile(join(process.cwd(), "data/plant-seed.yaml"));
    const scheduler = new EvaluationScheduler({ store, proposal: async () => "unused", cooldownMinutes: 30 });
    const classify = vi.fn().mockResolvedValue({ relevant: true, targetId: "INV-03", stepId: "inverter_nameplate" });
    const extract = vi.fn().mockResolvedValue({});
    const service = new CommissioningService({ store, scheduler, delaySeconds: 3600, classify, extract });
    const channelId = store.listChannelBindings()[0]!.channelId;
    const photo = { eventId: "event-blurred", channelId, messageTs: "3.0", text: "", files: [{ id: "F2", mimeType: "image/png", base64: "aGVsbG8=" }] };
    const outcome = await service.ingest(photo);
    expect(outcome).toMatchObject({ ignored: "image_not_matching", unreadableFields: ["serial"] });
    expect(outcome.stepName).toBeDefined();
    expect(store.listOpenRecords(channelId)).toHaveLength(0);
    scheduler.stop(); store.close(); rmSync(folder, { recursive: true, force: true });
  });

  it("reports an image unrelated to the protocol as not matching", async () => {
    const folder = mkdtempSync(join(tmpdir(), "commissioning-app-")); const store = new SqliteStore(join(folder, "state.sqlite"));
    store.initialize(); store.seedFromFile(join(process.cwd(), "data/plant-seed.yaml"));
    const scheduler = new EvaluationScheduler({ store, proposal: async () => "unused", cooldownMinutes: 30 });
    const classify = vi.fn().mockResolvedValue({ relevant: false }); const extract = vi.fn();
    const service = new CommissioningService({ store, scheduler, delaySeconds: 3600, classify, extract });
    const photo = { eventId: "event-unrelated", channelId: store.listChannelBindings()[0]!.channelId, messageTs: "4.0", text: "", files: [{ id: "F3", mimeType: "image/jpeg", base64: "aGVsbG8=" }] };
    expect(await service.ingest(photo)).toEqual({ ignored: "image_not_matching", stepName: undefined, unreadableFields: undefined });
    expect(extract).not.toHaveBeenCalled();
    scheduler.stop(); store.close(); rmSync(folder, { recursive: true, force: true });
  });
});
