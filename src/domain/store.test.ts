import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteStore } from "./store.js";

describe("SqliteStore", () => {
  it("seeds plant context and persists dedupe across reopen", () => {
    const folder = mkdtempSync(join(tmpdir(), "commissioning-store-"));
    const path = join(folder, "state.sqlite");
    const store = new SqliteStore(path);
    store.initialize();
    store.seedFromFile(join(process.cwd(), "data/plant-seed.yaml"));
    expect(store.listChannelBindings()).toContainEqual(expect.objectContaining({ blockId: "INV-03", enabled: true }));
    expect(store.getEquipment("INV-03")?.serialExpected).toBe("A240903042");
    const channelId = store.listChannelBindings()[0]!.channelId;
    expect(store.markEventProcessed("event-1", channelId, "1.000")).toBe(true);
    store.close();
    const reopened = new SqliteStore(path);
    reopened.initialize();
    expect(reopened.markEventProcessed("event-1", channelId, "1.000")).toBe(false);
    reopened.close();
    rmSync(folder, { recursive: true, force: true });
  });
});
