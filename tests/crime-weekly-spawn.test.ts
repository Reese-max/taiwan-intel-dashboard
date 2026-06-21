import { describe, expect, it } from "vitest";
import { crimeWeeklySpawnEnv } from "../scripts/lib/fetch-police.mjs";

describe("crime weekly parser spawn environment", () => {
  it("forces UTF-8 stdout on Windows code-page shells", () => {
    const env = crimeWeeklySpawnEnv({ PATH: "x" });

    expect(env.PYTHONIOENCODING).toBe("utf-8");
    expect(env.PYTHONUTF8).toBe("1");
    expect(env.PATH).toBe("x");
  });
});
