import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteStore } from "../domain/store.js";
import { shouldActivate } from "./activation.js";
import { accumulateSignal } from "./accumulate.js";
import { normalizeSlackSignal } from "./normalize.js";

describe("signal layer", () => {
  it("normalizes and accumulates a burst into one persistent record", () => {
    const folder = mkdtempSync(join(tmpdir(), "commissioning-signals-"));
    const store = new SqliteStore(join(folder, "state.sqlite")); store.initialize();
    const signal = normalizeSlackSignal({ event_id: "e1", event: { channel: "C-DEMO", ts: "1.0", text: "first" } });
    const first = accumulateSignal(store, { blockId: "INV-03" }, { targetId: "target", stepId: "step" }, { alpha: 1 }, signal, 20, new Date("2026-01-01T00:00:00Z"));
    const second = accumulateSignal(store, { blockId: "INV-03" }, { targetId: "target", stepId: "step" }, { beta: 2 }, { ...signal, eventId: "e2", messageTs: "2.0" }, 20, new Date("2026-01-01T00:00:10Z"));
    expect(second.id).toBe(first.id);
    expect(store.getRecord(first.id)?.observed).toEqual({ alpha: 1, beta: 2 });
    expect(shouldActivate({ complete: false, missing: ["alpha"], failedChecks: [] })).toBe(true);
    expect(shouldActivate({ complete: true, missing: [], failedChecks: [] })).toBe(false);
    store.close(); rmSync(folder, { recursive: true, force: true });
  });
});
