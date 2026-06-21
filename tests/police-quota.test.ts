import { describe, expect, it } from "vitest";
import {
  POLICE_DEFAULT_LIMITS,
  POLICE_DATASET_IDS,
  POLICE_HOURLY_MINIMUM,
  plannedPoliceFetchCapacity,
} from "../scripts/lib/fetch-police.mjs";

describe("police hourly quota", () => {
  it("plans at least 200 police-related records per hourly fetch", () => {
    expect(POLICE_HOURLY_MINIMUM).toBe(200);
    expect(plannedPoliceFetchCapacity(POLICE_DEFAULT_LIMITS)).toBeGreaterThanOrEqual(
      POLICE_HOURLY_MINIMUM,
    );
    expect(plannedPoliceFetchCapacity(POLICE_DEFAULT_LIMITS)).toBeGreaterThanOrEqual(3000);
  });

  it("includes every selected official police dataset in the police matcher", () => {
    for (const datasetId of [
      "7505",
      "11307",
      "12197",
      "57268",
      "136123",
      "173625",
      "168403",
      "169080",
      "146885",
      "167814",
      "172950",
      "133922",
      "133923",
      "133924",
      "143467",
      "171164",
      "171167",
      "176021",
      "78638",
      "155895",
      "90589",
      "159972",
      "171349",
      "173142",
      "172940",
      "157949",
      "151006",
      "146936",
      "176455",
      "177136",
      "13166",
    ]) {
      expect(POLICE_DATASET_IDS.has(datasetId)).toBe(true);
    }
  });
});
