import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { DiskSpaceAnalyzer } from "../src/analyzer.js";
import { listInput, relativeOutputPath, scanInput, withTempDirectory, writeSizedFile } from "./test-helpers.js";

test("an empty directory produces exact zero totals", async () => {
  await withTempDirectory("disk-space-empty-", async (rootPath) => {
    const analyzer = new DiskSpaceAnalyzer();
    const result = await analyzer.scanDirectory(scanInput(rootPath, { exclude_patterns: [] }));

    assert.equal(result.ok, true);
    assert.equal(result.error, null);
    assert.equal(result.total_size_bytes, 0);
    assert.equal(result.file_count, 0);
    assert.equal(result.folder_count, 0);
    assert.equal(result.excluded_count, 0);
    assert.equal(result.warning_count, 0);
    assert.equal(result.warnings_omitted, 0);
    assert.deepEqual(result.warnings, []);
  });
});

test("nested files aggregate into parent directories without double counting", async () => {
  await withTempDirectory("disk-space-nested-", async (rootPath) => {
    await writeSizedFile(path.join(rootPath, "root.bin"), 3);
    await writeSizedFile(path.join(rootPath, "nested", "child.bin"), 5);
    await writeSizedFile(path.join(rootPath, "nested", "deeper", "leaf.bin"), 7);
    const analyzer = new DiskSpaceAnalyzer();

    const scan = await analyzer.scanDirectory(scanInput(rootPath, { exclude_patterns: [] }));

    assert.equal(scan.ok, true);
    assert.equal(scan.total_size_bytes, 15);
    assert.equal(scan.file_count, 3);
    assert.equal(scan.folder_count, 2);

    const directories = await analyzer.listLargestItems(listInput({ top_n: 10, item_type: "directory" }));
    assert.equal(directories.ok, true);
    assert.deepEqual(
      directories.items.map((item) => [relativeOutputPath(rootPath, item.path), item.size_bytes, item.complete]),
      [
        ["nested", 12, true],
        ["nested/deeper", 7, true]
      ]
    );
  });
});
