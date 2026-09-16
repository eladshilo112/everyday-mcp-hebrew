import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "./helpers.js";

test("quoted separators, escaped quotes, LF/CRLF and multiline positions", () => {
  const result = parse('a,b\r\n"x,y","say ""hello"""\r\n"multi\r\nline",ok\r\nshort\r\n');
  assert.equal(result.complete, true);
  assert.equal(result.records_completed, 4);
  assert.equal(result.data_records, 3);
  assert.deepEqual(result.findings, [{ code: "COLUMN_COUNT", record: 4, line: 5, expected: 2, actual: 1 }]);
  assert.equal(parse('a,b\n"x\ny",z\n').ok, true);
});
test("missing and extra columns remain in file order and omit source contents", () => {
  const result = parse("secretA,secretB\none\none,two,three");
  assert.deepEqual(result.findings, [
    { code: "COLUMN_COUNT", record: 2, line: 2, expected: 2, actual: 1 },
    { code: "COLUMN_COUNT", record: 3, line: 3, expected: 2, actual: 3 }
  ]);
  assert.doesNotMatch(JSON.stringify(result), /secret|one|two|three/);
});
test("headers compare exactly without trimming, case folding or Unicode normalization", () => {
  const result = parse(',A,A, A,a,é,e\u0301,\n');
  assert.deepEqual(result.findings, [
    { code: "EMPTY_HEADER", record: 1, line: 1, field: 1 },
    { code: "DUPLICATE_HEADER", record: 1, line: 1, field: 3 },
    { code: "EMPTY_HEADER", record: 1, line: 1, field: 8 },
    { code: "DUPLICATE_HEADER", record: 1, line: 1, field: 8 }
  ]);
  assert.equal(parse(',A,A, A,a,é,e\u0301,\n', { header: false }).ok, true);
  assert.deepEqual(parse('"a\nb",,"a\nb"').findings, [
    { code: "EMPTY_HEADER", record: 1, line: 2, field: 2 },
    { code: "DUPLICATE_HEADER", record: 1, line: 2, field: 3 }
  ]);
});
for (const [body, code, line, field] of [
  ['a,b\nx"y,z\n1,2,3', "BARE_QUOTE", 2, 1],
  ['a,b\n"x" y,z\n1,2,3', "AFTER_CLOSING_QUOTE", 2, 1],
  ['a,b\nx,"y\nz', "UNTERMINATED_QUOTE", 3, 2],
  ['a,b\nx\ry,z', "BARE_CR", 2, 1]
] as const) {
  test(`syntax ${code} stops before subsequent misleading records`, () => {
    const result = parse(body);
    assert.equal(result.complete, false); assert.equal(result.status, "syntax_error");
    assert.equal(result.records_completed, 1);
    assert.deepEqual(result.findings, [{ code, record: 2, line, field }]);
    assert.deepEqual(result.error, { code });
  });
}
test("explicit delimiters only", () => {
  for (const [delimiter, separator] of [["comma", ","], ["semicolon", ";"], ["tab", "\t"]] as const) {
    assert.equal(parse(`a${separator}b\n1${separator}2`, { delimiter }).expected_columns, 2);
  }
  assert.equal(parse("a;b\n1;2").expected_columns, 1);
});
test("empty, header-only, final terminators, blank lines and empty quoted fields", () => {
  assert.deepEqual(parse("").findings, [{ code: "EMPTY_FILE", record: 0, line: 1 }]);
  assert.equal(parse("").complete, true);
  for (const ending of ["", "\n", "\r\n"]) {
    assert.equal(parse("a,b" + ending).records_completed, 1);
    assert.equal(parse("a,b" + ending).data_records, 0);
  }
  assert.equal(parse("a\n\nend\n").records_completed, 3);
  assert.equal(parse("\n", { header: false }).records_completed, 1);
  assert.equal(parse('""', { header: false }).expected_columns, 1);
  assert.equal(parse("a,b\n\n1,2").findings[0]?.actual, 1);
  assert.equal(parse("a,b\n1,").ok, true);
});
