import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { DiskSpaceAnalyzer } from "../src/analyzer.js";
import { relativeOutputPath, scanInput, withTempDirectory, writeSizedFile } from "./test-helpers.js";

test("the default exclusions omit .git and node_modules trees", async () => {
  await withTempDirectory("disk-space-exclusions-", async (rootPath) => {
    await writeSizedFile(path.join(rootPath, "visible.bin"), 4);
    await writeSizedFile(path.join(rootPath, ".git", "objects", "hidden.bin"), 20);
    await writeSizedFile(path.join(rootPath, "node_modules", "package", "hidden.bin"), 30);
    const analyzer = new DiskSpaceAnalyzer();

    const result = await analyzer.scanDirectory(scanInput(rootPath));

    assert.equal(result.ok, true);
    assert.deepEqual(result.exclude_patterns, [".git", "node_modules"]);
    assert.equal(result.total_size_bytes, 4);
    assert.equal(result.file_count, 1);
    assert.equal(result.folder_count, 0);
    assert.equal(result.excluded_count, 2);
    assert.equal(result.warning_count, 0);
  });
});

test("max_depth includes immediate children and records skipped grandchildren", async () => {
  await withTempDirectory("disk-space-depth-", async (rootPath) => {
    await writeSizedFile(path.join(rootPath, "root.bin"), 1);
    await writeSizedFile(path.join(rootPath, "first", "child.bin"), 2);
    await writeSizedFile(path.join(rootPath, "first", "second", "grandchild.bin"), 4);
    const analyzer = new DiskSpaceAnalyzer();

    const result = await analyzer.scanDirectory(scanInput(rootPath, {
      max_depth: 1,
      exclude_patterns: []
    }));

    assert.equal(result.ok, true);
    assert.equal(result.max_depth, 1);
    assert.equal(result.total_size_bytes, 3);
    assert.equal(result.file_count, 2);
    assert.equal(result.folder_count, 2);
    assert.equal(result.warning_count, 1);
    assert.equal(result.warnings[0]?.code, "MAX_DEPTH_REACHED");
    assert.equal(relativeOutputPath(rootPath, result.warnings[0]?.path ?? ""), "first/second");
  });
});
