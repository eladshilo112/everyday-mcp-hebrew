import assert from "node:assert/strict";
import path from "node:path";
import { symlink, writeFile } from "node:fs/promises";
import test, { beforeEach } from "node:test";
import { findDuplicates } from "../src/duplicates.js";
import { clearScanSessionsForTests, scanDirectory } from "../src/scanner.js";
import { scanInput, withTempDirectory } from "./test-helpers.js";

beforeEach(() => clearScanSessionsForTests());

test("three identical files and two unique files produce one three-path duplicate group", async () => {
  await withTempDirectory("duplicate-scan-", async (rootPath) => {
    await Promise.all([
      writeFile(path.join(rootPath, "copy-c.txt"), "identical"),
      writeFile(path.join(rootPath, "copy-a.txt"), "identical"),
      writeFile(path.join(rootPath, "copy-b.txt"), "identical"),
      writeFile(path.join(rootPath, "unique-a.txt"), "alpha"),
      writeFile(path.join(rootPath, "unique-b.txt"), "bravo")
    ]);

    const scan = await scanDirectory(scanInput(rootPath));
    assert.equal(scan.ok, true);
    const duplicates = findDuplicates(scan.scan_id ?? undefined);
    assert.equal(duplicates.total_groups, 1);
    assert.deepEqual(duplicates.duplicate_groups[0]?.paths, [
      "copy-a.txt",
      "copy-b.txt",
      "copy-c.txt"
    ]);
  });
});

test("an empty directory succeeds with no files", async () => {
  await withTempDirectory("duplicate-empty-", async (rootPath) => {
    const scan = await scanDirectory(scanInput(rootPath));
    assert.equal(scan.ok, true);
    assert.deepEqual(scan.files, []);
    assert.deepEqual(findDuplicates(scan.scan_id ?? undefined).duplicate_groups, []);
  });
});

test("a nonexistent directory returns a structured error without a stack trace", async () => {
  await withTempDirectory("duplicate-missing-", async (rootPath) => {
    const missingPath = path.join(rootPath, "does-not-exist");
    const result = await scanDirectory(scanInput(missingPath));
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_found");
    assert.doesNotMatch(result.error?.message ?? "", /\bat\s+\S+\s*\(/u);
  });
});

test("a file path returns a clear not-directory error", async () => {
  await withTempDirectory("duplicate-file-path-", async (rootPath) => {
    const filePath = path.join(rootPath, "single.txt");
    await writeFile(filePath, "content");
    const result = await scanDirectory(scanInput(filePath));
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_directory");
    assert.match(result.error?.message ?? "", /not a directory/u);
  });
});

test("an oversized file is skipped instead of hashed", async () => {
  await withTempDirectory("duplicate-large-", async (rootPath) => {
    await writeFile(path.join(rootPath, "large.bin"), Buffer.alloc(9, 1));
    const result = await scanDirectory(scanInput(rootPath, { max_file_size_bytes: 8 }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.files, []);
    assert.deepEqual(result.skipped, [{ path: "large.bin", reason: "too_large" }]);
  });
});

test("a symlink is reported and never followed", async (context) => {
  await withTempDirectory("duplicate-link-", async (rootPath) => {
    const targetPath = path.join(rootPath, "target.txt");
    const linkPath = path.join(rootPath, "linked.txt");
    await writeFile(targetPath, "content");
    try {
      await symlink(targetPath, linkPath, "file");
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (code === "EPERM" || code === "EACCES") {
        context.skip("Creating symlinks is not permitted on this host.");
        return;
      }
      throw error;
    }

    const result = await scanDirectory(scanInput(rootPath));
    assert.equal(result.ok, true);
    assert.deepEqual(result.files.map((file) => file.path), ["target.txt"]);
    assert.deepEqual(result.skipped, [{ path: "linked.txt", reason: "symlink" }]);
  });
});
