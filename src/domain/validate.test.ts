import { describe, expect, it } from "vitest";
import { getStep, loadProtocol } from "./protocol.js";
import { validateStep } from "./validate.js";

const protocol = loadProtocol("pv-string-verification");
const voc = getStep(protocol, "voc");

describe("validateStep", () => {
  it("reports missing protocol-required fields deterministically", () => {
    const result = validateStep(voc, { voc_v: 842, module_temp_c: 47, instrument: "SMFT-1000" }, {});
    expect(result).toMatchObject({ complete: false, missing: ["irradiance_w_m2"], failedChecks: [] });
  });

  it("skips acceptance checks after failed conditions", () => {
    const result = validateStep(voc, { voc_v: 700, irradiance_w_m2: 620, module_temp_c: 46, instrument: "SMFT-1000" }, {});
    expect(result.failedChecks).toEqual([expect.objectContaining({ field: "irradiance_w_m2", phase: "condition" })]);
    expect(result.skippedAcceptanceChecks).toEqual(["voc_v"]);
  });

  it("compares nameplates with an explicit expected-value allowlist", () => {
    const step = getStep(protocol, "inverter_nameplate");
    expect(validateStep(step, { serial: "SG125CX-P2-AF240024" }, { equipment: { serialExpected: "SG125CX-P2-AF240024" } }).complete).toBe(true);
    expect(validateStep(step, { serial: "other" }, { equipment: { serialExpected: "SG125CX-P2-AF240024" } }).failedChecks).toHaveLength(1);
  });
});
