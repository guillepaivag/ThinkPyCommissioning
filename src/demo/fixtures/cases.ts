import type { ObservedValues } from "../../utils/types.js";

export type FixtureSignal = { text: string; extracted: ObservedValues; messageTs: string; targetId?: string; stepId?: string };
export type DemoFixture = {
  id: string; title: string; targetId: string; stepId: string; signals: FixtureSignal[];
  expected: { complete: boolean; activation: boolean; missing?: string[]; failedField?: string; skippedAcceptance?: boolean };
};

export const demoFixtures: DemoFixture[] = [
  { id: "case1", title: "Missing irradiance", targetId: "STR-03-01", stepId: "voc", signals: [{ text: "STR-03-01 Voc 842 V, módulo 47 °C, SMFT-1000", extracted: { voc_v: 842, module_temp_c: 47, instrument: "SMFT-1000" }, messageTs: "1.001" }], expected: { complete: false, activation: true, missing: ["irradiance_w_m2"] } },
  { id: "case2", title: "Complete Voc", targetId: "STR-03-01", stepId: "voc", signals: [{ text: "STR-03-01 Voc 842 V, irradiancia 940 W/m², módulo 47 °C, SMFT-1000", extracted: { voc_v: 842, irradiance_w_m2: 940, module_temp_c: 47, instrument: "SMFT-1000" }, messageTs: "2.001" }], expected: { complete: true, activation: false } },
  { id: "case3", title: "Missing module temperature", targetId: "STR-03-02", stepId: "isc", signals: [{ text: "STR-03-02 Isc 13.1 A, irradiancia 930 W/m², SMFT-1000", extracted: { isc_a: 13.1, irradiance_w_m2: 930, instrument: "SMFT-1000" }, messageTs: "3.001" }], expected: { complete: false, activation: true, missing: ["module_temp_c"] } },
  { id: "case4", title: "Invalid irradiance", targetId: "STR-03-01", stepId: "voc", signals: [{ text: "STR-03-01 Voc 839 V, irradiancia 620 W/m², módulo 46 °C, SMFT-1000", extracted: { voc_v: 839, irradiance_w_m2: 620, module_temp_c: 46, instrument: "SMFT-1000" }, messageTs: "4.001" }], expected: { complete: false, activation: true, failedField: "irradiance_w_m2", skippedAcceptance: true } },
  { id: "case5", title: "Wrong nameplate", targetId: "INV-03", stepId: "inverter_nameplate", signals: [{ text: "A240903024", extracted: { serial: "A240903024" }, messageTs: "5.001" }], expected: { complete: false, activation: true, failedField: "serial" } },
  { id: "case6", title: "Correct nameplate", targetId: "INV-03", stepId: "inverter_nameplate", signals: [{ text: "A240903042", extracted: { serial: "A240903042" }, messageTs: "6.001" }], expected: { complete: true, activation: false } },
  { id: "case7", title: "Unreadable image", targetId: "INV-03", stepId: "inverter_nameplate", signals: [{ text: "[imagen ilegible]", extracted: {}, messageTs: "7.001" }], expected: { complete: false, activation: true, missing: ["serial"] } },
  { id: "case8", title: "Burst messages", targetId: "STR-03-01", stepId: "voc", signals: [
    { text: "STR-03-01 Voc 842 V", extracted: { voc_v: 842 }, messageTs: "8.001" },
    { text: "módulo 47 grados", extracted: { module_temp_c: 47 }, messageTs: "8.002" },
    { text: "irradiancia 940, SMFT-1000", extracted: { irradiance_w_m2: 940, instrument: "SMFT-1000" }, messageTs: "8.003" }
  ], expected: { complete: true, activation: false } },
  { id: "case9", title: "Late completion", targetId: "STR-03-01", stepId: "voc", signals: [
    { text: "STR-03-01 Voc 842 V, módulo 47 °C, SMFT-1000", extracted: { voc_v: 842, module_temp_c: 47, instrument: "SMFT-1000" }, messageTs: "9.001" },
    { text: "irradiancia 940 W/m²", extracted: { irradiance_w_m2: 940 }, messageTs: "9.002" }
  ], expected: { complete: true, activation: false } }
];
