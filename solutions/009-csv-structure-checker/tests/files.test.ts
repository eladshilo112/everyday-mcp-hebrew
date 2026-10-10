import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { readLocal, resolveInput, validateRoot } from "../src/files.js";
import { checkCsv } from "../src/checker.js";
import { LIMITS } from "../src/types.js";
import { fixture } from "./helpers.js";

test("UTF-8 BOM Hebrew CRLF, determinism and unchanged file hash", async () => {
  const f = await fixture();
  try {
    await f.put("valid.csv", "\ufeffשם,עיר\r\nבדיקה,דוגמה\r\n");
    const root = await validateRoot(f.root);
    const hash = async () => createHash("sha256").update(await readFile(path.join(root, "valid.csv"))).digest("hex");
    const before = await hash();
    const first = await checkCsv(root, { path: "valid.csv" });
    assert.equal(first.ok, true); assert.equal(first.records_completed, 2);
    assert.deepEqual(await checkCsv(root, { path: "valid.csv" }), first);
    assert.equal(await hash(), before);
    await f.put("bom.csv", "\ufeff");
    assert.equal((await checkCsv(root, { path: "bom.csv" })).findings[0]?.code, "EMPTY_FILE");
  } finally { await f.close(); }
});
test("invalid UTF-8, UTF-16 BOM, NUL and truncated sequences fail without excerpts", async () => {
  const f = await fixture();
  try {
    for (const bytes of [[0xc3, 0x28], [0xff, 0xfe, 0x61, 0], [0x61, 0], [0xe2, 0x82]]) {
      await f.put("bad.csv", Buffer.from(bytes));
      const result = await checkCsv(f.root, { path: "bad.csv" });
      assert.equal(result.error?.code, "UNSUPPORTED_ENCODING");
      assert.equal(result.status, "error"); assert.deepEqual(result.findings, []);
      assert.ok(!JSON.stringify(result).includes("\ufffd"));
    }
  } finally { await f.close(); }
});
test("absolute, traversal, UNC, ADS, devices, aliases and ambiguous paths are rejected", () => {
  for (const input of ["/a", "C:\\a", "C:a", "\\\\server\\share\\a", "../a", "a/../b", "a\\..\\b", "a//b", "./a", "a:stream", "NUL.csv", "a.", "a ", "a\0b", ""]) {
    assert.throws(() => resolveInput(path.resolve("."), input));
  }
});
test("missing paths, directory input and invalid arguments return bounded errors", async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.root, "folder"));
    assert.equal((await checkCsv(f.root, { path: "missing.csv" })).error?.code, "READ_ERROR");
    assert.equal((await checkCsv(f.root, { path: "folder" })).error?.code, "NOT_REGULAR_FILE");
    for (const options of [{ max_findings: 0 }, { max_findings: 201 }, { max_findings: 1.2 }, { delimiter: "auto" }, { header: "true" }, { extra: true }]) {
      assert.equal((await checkCsv(f.root, { path: "x.csv", ...options })).error?.code, "INVALID_INPUT");
    }
    await assert.rejects(validateRoot("relative"));
  } finally { await f.close(); }
});
test("directory links/junctions are rejected inside, outside and at startup root", async () => {
  const f = await fixture();
  try {
    const inside = path.join(f.root, "inside");
    await mkdir(inside); await f.put("inside/test.csv", "a\n1");
    const link = path.join(f.root, "link");
    await symlink(inside, link, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(readLocal(f.root, "link/test.csv"));
    await assert.rejects(validateRoot(link));
    const outsideLink = path.join(inside, "outside");
    await symlink(f.root, outsideLink, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(readLocal(inside, "outside/inside/test.csv"));
  } finally { await f.close(); }
});
test("file symlinks rejected where OS permits creation", async t => {
  const f = await fixture();
  try {
    await f.put("a.csv", "a\n1");
    try { await symlink(path.join(f.root, "a.csv"), path.join(f.root, "link.csv"), "file"); }
    catch (error) {
      if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") { t.skip("Windows file-symlink privilege unavailable; junction tested separately"); return; }
      throw error;
    }
    await assert.rejects(readLocal(f.root, "link.csv"));
  } finally { await f.close(); }
});
test("real file byte boundary and oversized file", async () => {
  const f = await fixture();
  try {
    const line = "a".repeat(255) + "\n";
    await f.put("boundary.csv", line.repeat(LIMITS.fileBytes / 256));
    assert.equal((await checkCsv(f.root, { path: "boundary.csv", header: false })).ok, true);
    await f.put("boundary.csv", line.repeat(LIMITS.fileBytes / 256) + "a");
    const result = await checkCsv(f.root, { path: "boundary.csv" });
    assert.equal(result.status, "resource_limit"); assert.equal(result.error?.code, "FILE_BYTES_LIMIT");
  } finally { await f.close(); }
});
