import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, afterEach, beforeEach } from "vitest";

import { minifyOrCopyJson } from "../scripts/lib/minify-json.mjs";

describe("minifyOrCopyJson", () => {
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "build-static-minify-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("minifies valid JSON to single-line output and preserves data", () => {
    const src = join(tmp, "valid.json");
    const dest = join(tmp, "dest.json");
    const payload = {
      title: "測試",
      nested: { value: 1, list: [1, 2, 3] },
    };

    writeFileSync(src, JSON.stringify(payload, null, 2));
    const wasMinified = minifyOrCopyJson(src, dest);
    const output = readFileSync(dest, "utf8");

    expect(wasMinified).toBe(true);
    expect(output.includes("\n  ")).toBe(false);
    expect(JSON.parse(output)).toEqual(payload);
    expect(output.length).toBeLessThan(JSON.stringify(payload, null, 2).length);
  });

  it("falls back to copy when JSON is invalid", () => {
    const src = join(tmp, "invalid.json");
    const dest = join(tmp, "fallback.json");
    const raw = '{"title":"測試","oops": [1,2,]';

    writeFileSync(src, raw);
    const wasMinified = minifyOrCopyJson(src, dest);

    expect(wasMinified).toBe(false);
    expect(readFileSync(src)).toEqual(readFileSync(dest));
  });

  it("keeps non-JSON files copied as-is", () => {
    const src = join(tmp, "notes.txt");
    const dest = join(tmp, "notes-copy.txt");
    const raw = "not-json-by-design\n";

    writeFileSync(src, raw);
    const wasMinified = minifyOrCopyJson(src, dest);

    expect(wasMinified).toBe(false);
    expect(readFileSync(src, "utf8")).toBe(readFileSync(dest, "utf8"));
  });
});
