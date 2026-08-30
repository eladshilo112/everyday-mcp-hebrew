import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { DiskSpaceAnalyzer } from "../src/analyzer.js";
import { listInput, relativeOutputPath, scanInput, withTempDirectory, writeSizedFile } from "./test-helpers.js";

test("files are ranked by descending size with an alphabetical tie break", async () => {
  await withTempDirectory("disk-space-ranking-", async (rootPath) => {
    await writeSizedFile(path.join(rootPath, "zeta.bin"), 7);
    await writeSizedFile(path.join(rootPath, "alpha.bin"), 7);
    await writeSizedFile(path.join(rootPath, "largest.bin"), 12);
    await writeSizedFile(path.join(rootPath, "tiny.bin"), 1);
    const analyzer = new DiskSpaceAnalyzer();
    await analyzer.scanDirectory(scanInput(rootPath, { exclude_patterns: [] }));

    const result = await analyzer.listLargestItems(listInput({ top_n: 3, item_type: "file" }));

    assert.equal(result.ok, true);
    assert.equal(result.error, null);
    assert.equal(result.top_n, 3);
    assert.equal(result.item_type, "file");
    assert.equal(result.returned_count, 3);
    assert.deepEqual(
      result.items.map((item) => [relativeOutputPath(rootPath, item.path), item.type, item.size_bytes, item.complete]),
      [
        ["largest.bin", "file", 12, true],
        ["alpha.bin", "file", 7, true],
        ["zeta.bin", "file", 7, true]
      ]
    );
  });
});

test("default largest-items options return both files and directories", async () => {
  await withTempDirectory("disk-space-ranking-defaults-", async (rootPath) => {
    await writeSizedFile(path.join(rootPath, "folder", "file.bin"), 9);
    const analyzer = new DiskSpaceAnalyzer();
    await analyzer.scanDirectory(scanInput(rootPath, { exclude_patterns: [] }));

    const result = await analyzer.listLargestItems(listInput());

    assert.equal(result.top_n, 10);
    assert.equal(result.item_type, "all");
    assert.equal(result.returned_count, 2);
    assert.deepEqual(result.items.map((item) => item.type).sort(), ["directory", "file"]);
  });
});

test("POSIX literal backslashes remain distinct from directory separators", {
  skip: process.platform === "win32"
}, async () => {
  await withTempDirectory("disk-space-backslash-", async (rootPath) => {
    await writeSizedFile(path.join(rootPath, "literal\\name.bin"), 5);
    await writeSizedFile(path.join(rootPath, "literal", "name.bin"), 5);
    const analyzer = new DiskSpaceAnalyzer();
    await analyzer.scanDirectory(scanInput(rootPath, { exclude_patterns: [] }));

    const result = analyzer.listLargestItems(listInput({ top_n: 2, item_type: "file" }));

    assert.deepEqual(result.items.map((item) => item.path).sort(), [
      "literal/name.bin",
      "literal\\name.bin"
    ]);
  });
});
