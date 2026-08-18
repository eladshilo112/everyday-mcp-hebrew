import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import test, { beforeEach } from "node:test";
import { suggestCleanup } from "../src/duplicates.js";
import { clearScanSessionsForTests, scanDirectory } from "../src/scanner.js";
import { scanInput, snapshotFiles, withTempDirectory } from "./test-helpers.js";

beforeEach(() => clearScanSessionsForTests());

test("suggest_cleanup leaves every scanned file byte-identical", async () => {
  await withTempDirectory("duplicate-cleanup-", async (rootPath) => {
    await Promise.all([
      writeFile(path.join(rootPath, "c.txt"), "same"),
      writeFile(path.join(rootPath, "a.txt"), "same"),
      writeFile(path.join(rootPath, "b.txt"), "same"),
      writeFile(path.join(rootPath, "unique.txt"), "different")
    ]);
    const scan = await scanDirectory(scanInput(rootPath));
    const before = await snapshotFiles(rootPath);
    const proposal = suggestCleanup(scan.scan_id ?? undefined);
    const after = await snapshotFiles(rootPath);

    assert.equal(proposal.ok, true);
    assert.deepEqual(after, before);
    assert.equal(proposal.proposals[0]?.keep_path, "a.txt");
    assert.deepEqual(proposal.proposals[0]?.removal_candidates, ["b.txt", "c.txt"]);
    assert.match(proposal.notice_en, /did not delete, move, or modify/u);
  });
});

test("suggest_cleanup reports exact potential savings without taking action", async () => {
  await withTempDirectory("duplicate-savings-", async (rootPath) => {
    await writeFile(path.join(rootPath, "one.txt"), "12345");
    await writeFile(path.join(rootPath, "two.txt"), "12345");
    const scan = await scanDirectory(scanInput(rootPath));
    const result = suggestCleanup(scan.scan_id ?? undefined);
    assert.equal(result.total_candidates, 1);
    assert.equal(result.potential_savings_bytes, 5);
  });
});

test("suggest_cleanup returns an empty plan when a scan has no duplicates", async () => {
  await withTempDirectory("duplicate-no-cleanup-", async (rootPath) => {
    await writeFile(path.join(rootPath, "only.txt"), "only");
    const scan = await scanDirectory(scanInput(rootPath));
    const result = suggestCleanup(scan.scan_id ?? undefined);
    assert.equal(result.ok, true);
    assert.deepEqual(result.proposals, []);
    assert.equal(result.total_candidates, 0);
  });
});
