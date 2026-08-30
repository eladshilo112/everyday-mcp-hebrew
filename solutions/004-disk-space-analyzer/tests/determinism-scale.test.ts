import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { DiskSpaceAnalyzer } from "../src/analyzer.js";
import { listInput, scanInput, withTempDirectory, writeSizedFile } from "./test-helpers.js";

test("repeated scans and rankings are byte-identical", async () => {
  await withTempDirectory("disk-space-repeat-", async (rootPath) => {
    await writeSizedFile(path.join(rootPath, "z", "same.bin"), 8);
    await writeSizedFile(path.join(rootPath, "a", "same.bin"), 8);
    await writeSizedFile(path.join(rootPath, "middle.bin"), 3);
    const analyzer = new DiskSpaceAnalyzer();
    const input = scanInput(rootPath, { exclude_patterns: [] });

    const firstScan = JSON.stringify(await analyzer.scanDirectory(input));
    const firstList = JSON.stringify(await analyzer.listLargestItems(listInput()));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal(JSON.stringify(await analyzer.scanDirectory(input)), firstScan);
      assert.equal(JSON.stringify(await analyzer.listLargestItems(listInput())), firstList);
    }
  });
});

test("several thousand files retain exact counts and byte totals", async () => {
  await withTempDirectory("disk-space-scale-", async (rootPath) => {
    const fileCount = 3_000;
    const batchSize = 125;
    let expectedBytes = 0;
    for (let batchStart = 0; batchStart < fileCount; batchStart += batchSize) {
      const writes: Array<Promise<void>> = [];
      const batchEnd = Math.min(fileCount, batchStart + batchSize);
      for (let index = batchStart; index < batchEnd; index += 1) {
        const size = (index % 11) + 1;
        expectedBytes += size;
        const folder = `group-${String(index % 6).padStart(2, "0")}`;
        const fileName = `file-${String(index).padStart(4, "0")}.bin`;
        writes.push(writeSizedFile(path.join(rootPath, folder, fileName), size));
      }
      await Promise.all(writes);
    }
    const analyzer = new DiskSpaceAnalyzer();

    const result = await analyzer.scanDirectory(scanInput(rootPath, { exclude_patterns: [] }));

    assert.equal(result.ok, true);
    assert.equal(result.file_count, fileCount);
    assert.equal(result.folder_count, 6);
    assert.equal(result.total_size_bytes, expectedBytes);
    assert.equal(result.warning_count, 0);
  });
});
