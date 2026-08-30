import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { DiskSpaceAnalyzer } from "../src/analyzer.js";
import { scanInput, withTempDirectory, writeSizedFile } from "./test-helpers.js";

test("summary before the first scan is a structured no_scan result", async () => {
  const analyzer = new DiskSpaceAnalyzer();

  const summary = await analyzer.getScanSummary();

  assert.equal(summary.ok, false);
  assert.equal(summary.error?.code, "no_scan");
  assert.equal(typeof summary.error?.message, "string");
});

test("text and machine-readable summary fields describe the same latest scan", async () => {
  await withTempDirectory("disk-space-summary-", async (rootPath) => {
    await writeSizedFile(path.join(rootPath, "one.bin"), 10);
    await writeSizedFile(path.join(rootPath, "folder", "two.bin"), 20);
    const analyzer = new DiskSpaceAnalyzer();

    const scan = await analyzer.scanDirectory(scanInput(rootPath, { exclude_patterns: [] }));
    const summary = await analyzer.getScanSummary();

    assert.equal(scan.ok, true);
    assert.equal(summary.ok, true);
    assert.equal(summary.root_path, scan.root_path);
    assert.equal(summary.total_size_bytes, scan.total_size_bytes);
    assert.equal(summary.file_count, scan.file_count);
    assert.equal(summary.folder_count, scan.folder_count);
    assert.equal(summary.excluded_count, scan.excluded_count);
    assert.equal(summary.warning_count, scan.warning_count);
    assert.equal(summary.warnings_omitted, scan.warnings_omitted);
    assert.equal(summary.summary_text, scan.summary_text);
    assert.ok(summary.summary_text.length > 0);
  });
});
