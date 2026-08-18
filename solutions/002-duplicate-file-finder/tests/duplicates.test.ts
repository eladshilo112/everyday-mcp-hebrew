import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import test, { beforeEach } from "node:test";
import { findDuplicates } from "../src/duplicates.js";
import { clearScanSessionsForTests, scanDirectory } from "../src/scanner.js";
import { scanInput, withTempDirectory } from "./test-helpers.js";

beforeEach(() => clearScanSessionsForTests());

test("same-size files with different content are not duplicates", async () => {
  await withTempDirectory("duplicate-content-", async (rootPath) => {
    await writeFile(path.join(rootPath, "one.bin"), "abcd");
    await writeFile(path.join(rootPath, "two.bin"), "wxyz");
    const scan = await scanDirectory(scanInput(rootPath));
    const result = findDuplicates(scan.scan_id ?? undefined);
    assert.equal(result.ok, true);
    assert.deepEqual(result.duplicate_groups, []);
  });
});

test("duplicate groups and paths use deterministic lexical path ordering", async () => {
  await withTempDirectory("duplicate-order-", async (rootPath) => {
    await Promise.all([
      writeFile(path.join(rootPath, "z-last.txt"), "z-group"),
      writeFile(path.join(rootPath, "m-second.txt"), "z-group"),
      writeFile(path.join(rootPath, "b-second.txt"), "a-group"),
      writeFile(path.join(rootPath, "a-first.txt"), "a-group")
    ]);
    const scan = await scanDirectory(scanInput(rootPath));
    const result = findDuplicates(scan.scan_id ?? undefined);
    assert.deepEqual(
      result.duplicate_groups.map((group) => group.paths),
      [
        ["a-first.txt", "b-second.txt"],
        ["m-second.txt", "z-last.txt"]
      ]
    );
  });
});

test("find_duplicates returns a structured no-scan error", () => {
  const result = findDuplicates();
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "no_scan");
  assert.deepEqual(result.duplicate_groups, []);
});

test("an unavailable explicit scan identifier returns scan_not_found", () => {
  const result = findDuplicates("0".repeat(64));
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "scan_not_found");
});
