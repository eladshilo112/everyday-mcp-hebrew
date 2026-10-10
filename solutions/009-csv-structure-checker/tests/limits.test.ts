import assert from "node:assert/strict";
import test from "node:test";
import { readBounded, FileError } from "../src/files.js";
import { LIMITS } from "../src/types.js";
import { parse } from "./helpers.js";

test("record boundary includes header, excludes final terminator", () => {
  const at = parse("a\n".repeat(LIMITS.records));
  assert.equal(at.ok, true); assert.equal(at.records_completed, LIMITS.records);
  const over = parse("a\n".repeat(LIMITS.records) + "a");
  assert.equal(over.status, "resource_limit"); assert.equal(over.error?.code, "RECORD_LIMIT");
  assert.equal(over.records_completed, LIMITS.records);
  assert.equal(over.findings[0]?.record, LIMITS.records + 1);
});
test("field-count boundary, including empty fields", () => {
  assert.equal(parse(",".repeat(999), { header: false }).expected_columns, 1000);
  const over = parse(",".repeat(1000), { header: false });
  assert.equal(over.error?.code, "FIELD_COUNT_LIMIT"); assert.equal(over.records_completed, 0);
  assert.equal(over.findings[0]?.field, 1001);
});
test("decoded UTF-8 field byte boundary includes multiline CRLF and escaped quotes", () => {
  assert.equal(parse("x".repeat(LIMITS.fieldBytes)).ok, true);
  assert.equal(parse("x".repeat(LIMITS.fieldBytes + 1)).error?.code, "FIELD_BYTES_LIMIT");
  assert.equal(parse("א".repeat(LIMITS.fieldBytes / 2)).ok, true);
  assert.equal(parse("א".repeat(LIMITS.fieldBytes / 2) + "x").error?.code, "FIELD_BYTES_LIMIT");
  assert.equal(parse('"' + '""'.repeat(LIMITS.fieldBytes) + '"').ok, true);
  assert.equal(parse('"' + "x".repeat(LIMITS.fieldBytes - 2) + '\r\n"').ok, true);
  assert.equal(parse('"' + "x".repeat(LIMITS.fieldBytes - 1) + '\r\n"').error?.code, "FIELD_BYTES_LIMIT");
});
test("findings exact boundary is complete; next finding explicitly truncates", () => {
  for (const max_findings of [1, 200]) {
    const input = "a,b\n" + "x\n".repeat(max_findings);
    assert.equal(parse(input, { max_findings }).complete, true);
    const over = parse(input + "x\n", { max_findings });
    assert.equal(over.complete, false); assert.equal(over.error?.code, "FINDINGS_LIMIT");
    assert.equal(over.findings.length, max_findings);
  }
  const syntax = parse('a,b\nx\nx"', { max_findings: 1 });
  assert.equal(syntax.status, "syntax_error"); assert.equal(syntax.error?.code, "BARE_QUOTE");
});
test("stream byte limit works without metadata, including growth and partial reads", async () => {
  for (const size of [LIMITS.fileBytes - 1, LIMITS.fileBytes, LIMITS.fileBytes + 1]) {
    let consumed = 0;
    const reader = { async read(buffer: Buffer, offset: number, length: number, position: number) {
      assert.equal(position, consumed);
      const bytesRead = Math.min(length, 7777, size - consumed);
      buffer.fill(97, offset, offset + bytesRead); consumed += bytesRead;
      return { bytesRead };
    } };
    if (size <= LIMITS.fileBytes) assert.equal((await readBounded(reader)).length, size);
    else await assert.rejects(readBounded(reader), error => error instanceof FileError && error.code === "FILE_BYTES_LIMIT");
    assert.equal(consumed, size);
  }
});
