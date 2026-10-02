import assert from "node:assert/strict";
import test from "node:test";
import { analyze, parseHeadings } from "../src/headings.js";

test("valid ATX hierarchy, standalone H1, and mixed setext headings", () => {
  assert.deepEqual(analyze("a.md", "# Title\n## Section\n### Detail").findings, []);
  assert.deepEqual(analyze("a.md", "# Title").findings, []);
  assert.deepEqual(parseHeadings("Title\n===\n## Section\nDetail\n---"), [
    { line: 1, level: 1, text: "Title" }, { line: 3, level: 2, text: "Section" }, { line: 4, level: 2, text: "Detail" }
  ]);
});

test("skipped level cites both the offending and prior line", () => {
  const result = analyze("a.md", "# Title\n## Section\ntext\n#### Deep");
  assert.deepEqual(result.findings, [{ file: "a.md", line: 4, code: "SKIPPED_LEVEL", level: 4, related_lines: [2] }]);
});

test("multiple, missing and empty headings have stable lines", () => {
  assert.deepEqual(analyze("a.md", "# One\r\n## \r\n# Two").findings.map(f => [f.code, f.line, f.related_lines]), [
    ["EMPTY_HEADING", 2, []], ["MULTIPLE_H1", 3, [1, 3]]
  ]);
  assert.equal(analyze("a.md", "## Section").findings[0]?.code, "MISSING_H1");
});

test("duplicate formatted text at same level is detected, different levels are independent", () => {
  const findings = analyze("a.md", "# Title\n## **Bold** Title\n### Bold Title\n## Bold Title").findings;
  assert.deepEqual(findings.map(f => [f.code, f.line, f.related_lines, f.text]), [["DUPLICATE_HEADING", 4, [2], "Bold Title"]]);
});

test("fenced and indented code are not headings; CRLF positions remain correct", () => {
  const input = "# Title\r\n```sh\r\n# comment\r\n## fake\r\n```\r\n    ## indented\r\n## Real";
  assert.deepEqual(parseHeadings(input).map(h => h.line), [1, 7]);
  assert.deepEqual(analyze("a.md", input).findings, []);
});
