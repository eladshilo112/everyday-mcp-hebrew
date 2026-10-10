import assert from "node:assert/strict";
import test from "node:test";
import { scan } from "../src/scanner.js";
import { fixture } from "./helpers.js";

test("binary and invalid UTF-8 files are skipped with explicit notes", async () => {
  const f = await fixture();
  try {
    await f.put("binary.md", Buffer.from([0, 1, 2])); await f.put("invalid.md", Buffer.from([0xff]));
    const result = await scan(f.root, { paths: ["binary.md", "invalid.md"], recursive: false });
    assert.equal(result.ok, false); assert.equal(result.files_scanned, 0);
    assert.deepEqual(result.skipped.map(item => item.code), ["UNSUPPORTED_ENCODING_OR_BINARY", "UNSUPPORTED_ENCODING_OR_BINARY"]);
  } finally { await f.close(); }
});

test("traversal, absolute path and absent path never yield file content", async () => {
  const f = await fixture();
  try {
    const result = await scan(f.root, { paths: ["../outside.md", "C:\\outside.md", "missing.md"], recursive: false });
    assert.equal(result.files_scanned, 0);
    assert.deepEqual(result.errors.map(item => item.code).sort(), ["NOT_FOUND", "PATH_REJECTED", "PATH_REJECTED"]);
  } finally { await f.close(); }
});

test("same unchanged scan yields byte identical output and findings cap", async () => {
  const f = await fixture();
  try {
    await f.put("a.md", "## Section\n" + "### Duplicate\n".repeat(250));
    const input = { paths: ["a.md"], recursive: false };
    const first = await scan(f.root, input), second = await scan(f.root, input);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(first.findings.length, 200); assert.equal(first.truncated, true);
  } finally { await f.close(); }
});

test("empty directory is successful and oversized markdown is skipped", async () => {
  const f = await fixture();
  try {
    const empty = await scan(f.root, { directory: ".", recursive: true });
    assert.deepEqual(empty, { ok: true, files_scanned: 0, files: [], findings: [], truncated: false, skipped: [], errors: [] });
    await f.put("large.md", "# Heading\n" + "x".repeat(2_000_000));
    const large = await scan(f.root, { paths: ["large.md"], recursive: false });
    assert.equal(large.files_scanned, 0);
    assert.deepEqual(large.skipped, [{ path: "large.md", code: "FILE_TOO_LARGE" }]);
  } finally { await f.close(); }
});
