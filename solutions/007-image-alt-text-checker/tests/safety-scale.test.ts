import assert from "node:assert/strict";
import { readFile, stat, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { scanAltText, getAltTextReport } from "../src/scanner.js";
import { MAX_FILE_BYTES, MAX_RETURNED_ITEMS } from "../src/schemas.js";
import { fixture } from "./helpers.js";

test("repeated scans are byte-identical and preserve content and mtime", async () => {
  const f = await fixture({ "a.md": "![](a)\n![image](b)" });
  try {
    const file = path.join(f.directory, "a.md");
    const before = await stat(file); const bytes = await readFile(file);
    const first = await scanAltText({ directory: f.directory });
    assert.equal(JSON.stringify(first), JSON.stringify(await scanAltText({ directory: f.directory })));
    await getAltTextReport({ directory: f.directory });
    assert.deepEqual(await readFile(file), bytes); assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  } finally { await f.cleanup(); }
});
test("findings cap does not truncate aggregate counts", async () => {
  const f = await fixture({ "a.md": "![IMAGE](x)\n".repeat(MAX_RETURNED_ITEMS + 17) });
  try {
    const scan = await scanAltText({ directory: f.directory });
    assert.equal(scan.findings.length, MAX_RETURNED_ITEMS); assert.equal(scan.findings_omitted, 17);
    assert.equal(scan.by_issue.generic, MAX_RETURNED_ITEMS + 17);
    assert.equal(scan.by_file[0]?.total, MAX_RETURNED_ITEMS + 17);
    assert.equal(scan.complete, true);
  } finally { await f.cleanup(); }
});
test("file summaries are capped with exact omitted count", async () => {
  const f = await fixture(Object.fromEntries(Array.from({ length: MAX_RETURNED_ITEMS + 1 }, (_, i) => [`${String(i).padStart(4, "0")}.md`, "![](x)"])));
  try {
    const report = await getAltTextReport({ directory: f.directory });
    assert.equal(report.by_file.length, MAX_RETURNED_ITEMS); assert.equal(report.files_omitted, 1);
    assert.equal(report.total_findings, MAX_RETURNED_ITEMS + 1);
  } finally { await f.cleanup(); }
});
test("oversized files produce an incomplete scan with a reason", async () => {
  const f = await fixture({ "large.md": "x".repeat(MAX_FILE_BYTES + 1) });
  try {
    const output = await scanAltText({ directory: f.directory });
    assert.equal(output.complete, false); assert.equal(output.errors[0]?.code, "FILE_TOO_LARGE");
  } finally { await f.cleanup(); }
});
test("symlink traversal and symlink roots are excluded", async t => {
  const f = await fixture({ "real/a.md": "![](x)" });
  try {
    try { await symlink(path.join(f.directory, "real"), path.join(f.directory, "linked"), process.platform === "win32" ? "junction" : "dir"); }
    catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) { t.skip("Host does not allow creating test symlinks"); return; }
      throw error;
    }
    const scan = await scanAltText({ directory: f.directory });
    assert.equal(scan.total_findings, 1);
    assert.equal((await scanAltText({ directory: path.join(f.directory, "linked") })).errors[0]?.code, "SYMLINK_ROOT");
  } finally { await f.cleanup(); }
});
