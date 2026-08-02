import { describe, expect, it } from "vitest";
import { inspectLockfile } from "../scripts/dependency-build-health.mjs";

describe("依賴建置健康檢查", () => {
  it("接受由 npm ci 支援且含根依賴的 lockfile v1", () => {
    const result = inspectLockfile(
      { name: "example", dependencies: { "left-pad": "^1.3.0" } },
      {
        lockfileVersion: 1,
        dependencies: {
          "left-pad": {
            version: "1.3.0",
            resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
            integrity: "sha512-x",
          },
        },
      },
    );

    expect(result).toMatchObject({ status: "passed", lockfileVersion: 1, rootManifestMatch: null, packageEntries: 1 });
  });
});
