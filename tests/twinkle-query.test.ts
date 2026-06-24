import { describe, expect, it } from "vitest";
import { parseTwinkleRowsText } from "../scripts/lib/twinkle-query.mjs";

describe("parseTwinkleRowsText", () => {
  it("turns MCP tool text errors into actionable errors", () => {
    expect(() => parseTwinkleRowsText("Error: User not allowed to call this tool.", "query_rows")).toThrow(
      "Twinkle MCP tool query_rows failed: User not allowed to call this tool.",
    );
  });
});
