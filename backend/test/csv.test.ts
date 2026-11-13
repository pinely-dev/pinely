import { describe, expect, it } from "bun:test";
import { toCsv } from "@pinely/shared/csv";

describe("toCsv", () => {
  it("writes plain rows with CRLF endings and a trailing newline", () => {
    expect(
      toCsv([
        ["a", "b"],
        [1, true],
      ]),
    ).toBe("a,b\r\n1,true\r\n");
  });

  it("renders null and undefined as empty cells", () => {
    expect(toCsv([["x", null, undefined, "y"]])).toBe("x,,,y\r\n");
  });

  it("quotes fields with commas, quotes and newlines, doubling inner quotes", () => {
    expect(toCsv([["a,b", 'say "hi"', "line1\nline2"]])).toBe(
      '"a,b","say ""hi""","line1\nline2"\r\n',
    );
  });

  it("neutralises spreadsheet formulas in text cells", () => {
    const row = ["=SUM(A1:A2)", "+1", "-1", "@cmd", "\tx", "\rx"];
    const encoded = toCsv([row]);
    for (const text of ["'=SUM(A1:A2)", "'+1", "'-1", "'@cmd"]) {
      expect(encoded).toContain(text);
    }
    // No cell may start with a formula character after encoding.
    for (const cell of encoded.trim().split(",")) {
      expect(/^"?[=+\-@\t\r]/.test(cell)).toBe(false);
    }
  });

  it("keeps negative numbers numeric and hex strings unchanged", () => {
    expect(toCsv([[-5, "0xabc123"]])).toBe("-5,0xabc123\r\n");
  });
});
