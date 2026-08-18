import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import test, { beforeEach } from "node:test";
import { findDuplicates } from "../src/duplicates.js";
import { clearScanSessionsForTests, scanDirectory } from "../src/scanner.js";
import { scanInput, withTempDirectory } from "./test-helpers.js";

beforeEach(() => clearScanSessionsForTests());

test("two duplicate lookups return byte-identical JSON", async () => {
  await withTempDirectory("duplicate-repeat-", async (rootPath) => {
    await writeFile(path.join(rootPath, "one.txt"), "same");
    await writeFile(path.join(rootPath, "two.txt"), "same");
    const scan = await scanDirectory(scanInput(rootPath));
    const first = JSON.stringify(findDuplicates(scan.scan_id ?? undefined));
    const second = JSON.stringify(findDuplicates(scan.scan_id ?? undefined));
    assert.equal(second, first);
  });
});

test("relative scans from two working directories produce the same grouping", async () => {
  await withTempDirectory("duplicate-cwd-", async (basePath) => {
    const targetPath = path.join(basePath, "target");
    const alternateCwd = path.join(basePath, "work");
    await mkdir(targetPath);
    await mkdir(alternateCwd);
    await writeFile(path.join(targetPath, "left.txt"), "same");
    await writeFile(path.join(targetPath, "right.txt"), "same");

    const originalCwd = process.cwd();
    try {
      process.chdir(basePath);
      const firstScan = await scanDirectory(scanInput("target"));
      const firstGroups = findDuplicates(firstScan.scan_id ?? undefined).duplicate_groups;

      process.chdir(alternateCwd);
      const secondScan = await scanDirectory(scanInput("../target"));
      const secondGroups = findDuplicates(secondScan.scan_id ?? undefined).duplicate_groups;

      assert.deepEqual(secondGroups, firstGroups);
      assert.equal(secondScan.scan_id, firstScan.scan_id);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

test("the configured regular-file limit returns a bounded structured error", async () => {
  await withTempDirectory("duplicate-limit-", async (rootPath) => {
    await writeFile(path.join(rootPath, "1.txt"), "one");
    await writeFile(path.join(rootPath, "2.txt"), "two");
    await writeFile(path.join(rootPath, "3.txt"), "three");
    const result = await scanDirectory(scanInput(rootPath, { max_files: 2 }));
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "limit_exceeded");
    assert.deepEqual(result.files, []);
  });
});

test("max depth prevents traversal into deeper directories", async () => {
  await withTempDirectory("duplicate-depth-", async (rootPath) => {
    const nestedPath = path.join(rootPath, "nested");
    await mkdir(nestedPath);
    await writeFile(path.join(rootPath, "root.txt"), "root");
    await writeFile(path.join(nestedPath, "deep.txt"), "deep");
    const result = await scanDirectory(scanInput(rootPath, { max_depth: 0 }));
    assert.deepEqual(result.files.map((file) => file.path), ["root.txt"]);
    assert.deepEqual(result.skipped, [{ path: "nested", reason: "max_depth" }]);
  });
});
