import { describe, expect, it } from "vitest";
import { findingBlocks, imageNotMatchingText, ProcessingIndicator } from "./slack.js";

describe("Slack presentation", () => {
  it("binds both human actions to the exact pending action id", () => {
    const blocks = findingBlocks("action-123", "Falta un campo.");
    const actions = blocks[1] as { elements: { value: string }[] };
    expect(actions.elements.map((element) => element.value)).toEqual(["action-123", "action-123"]);
  });

  it("marks a message as processing and clears it when its record is evaluated", async () => {
    const calls: string[] = [];
    const client = { reactions: {
      add: async ({ name, timestamp }: { name: string; timestamp: string }) => { calls.push(`add:${name}:${timestamp}`); },
      remove: async ({ name, timestamp }: { name: string; timestamp: string }) => { calls.push(`remove:${name}:${timestamp}`); }
    } };
    const indicator = new ProcessingIndicator(client as never, 1_000);
    expect(await indicator.begin("C1", "1.0")).toBe(true);
    expect(await indicator.begin("C1", "1.0")).toBe(false);
    indicator.attach("1.0", "record-1");
    await indicator.finishRecord("record-1");
    expect(calls).toEqual(["add:hourglass_flowing_sand:1.0", "remove:hourglass_flowing_sand:1.0"]);
  });

  it("replaces the processing mark with an error mark when no outcome arrives in time, and clears it on a late outcome", async () => {
    const calls: string[] = [];
    const client = { reactions: {
      add: async ({ name }: { name: string }) => { calls.push(`add:${name}`); },
      remove: async ({ name }: { name: string }) => { calls.push(`remove:${name}`); }
    } };
    const indicator = new ProcessingIndicator(client as never, 1_000);
    await indicator.begin("C1", "2.0");
    indicator.attach("2.0", "record-2");
    await indicator.expire(Date.now() + 5_000);
    expect(calls).toEqual(["add:hourglass_flowing_sand", "remove:hourglass_flowing_sand", "add:x"]);
    await indicator.finishRecord("record-2");
    expect(calls.at(-1)).toBe("remove:x");
  });

  it("says that an unreadable or unrelated image does not match what was expected", () => {
    expect(imageNotMatchingText("Inverter Nameplate", ["serial"])).toContain("no coincide con lo esperado");
    expect(imageNotMatchingText()).toContain("no coincide con lo esperado");
  });
});

