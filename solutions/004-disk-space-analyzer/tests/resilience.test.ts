import assert from "node:assert/strict";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import test from "node:test";
import { DiskSpaceAnalyzer, nodeFileSystem } from "../src/analyzer.js";
import type { LocalFileSystem } from "../src/analyzer.js";
import { relativeOutputPath, samePath, scanInput, withTempDirectory, writeSizedFile } from "./test-helpers.js";

function withStatsValues(
  stats: Stats,
  values: { dev?: number; ino?: number; size?: number }
): Stats {
  return new Proxy(stats, {
    get(target, property) {
      if (property === "dev" && values.dev !== undefined) return values.dev;
      if (property === "ino" && values.ino !== undefined) return values.ino;
      if (property === "size" && values.size !== undefined) return values.size;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("a nonexistent root returns a bounded structured error", async () => {
  await withTempDirectory("disk-space-missing-", async (rootPath) => {
    const analyzer = new DiskSpaceAnalyzer();
    const missingPath = path.join(rootPath, "does-not-exist");

    const result = await analyzer.scanDirectory(scanInput(missingPath));

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_found");
    assert.equal(typeof result.error?.message, "string");
    assert.doesNotMatch(result.error?.message ?? "", /\bat\s+\S+\s*\(/u);
    assert.equal(result.total_size_bytes, 0);
    assert.equal(result.file_count, 0);
    assert.deepEqual(result.warnings, []);
  });
});

test("an injected symbolic-link marker is skipped without OS symlink privileges", async () => {
  await withTempDirectory("disk-space-symlink-", async (rootPath) => {
    const markerPath = path.join(rootPath, "link-marker.bin");
    await writeSizedFile(markerPath, 50);
    await writeSizedFile(path.join(rootPath, "visible.bin"), 6);
    const injectedFileSystem: LocalFileSystem = {
      ...nodeFileSystem,
      lstat: async (candidatePath: string): Promise<Stats> => {
        if (samePath(candidatePath, markerPath)) {
          return { isSymbolicLink: () => true } as unknown as Stats;
        }
        return nodeFileSystem.lstat(candidatePath);
      }
    };
    const analyzer = new DiskSpaceAnalyzer(injectedFileSystem);

    const result = await analyzer.scanDirectory(scanInput(rootPath, { exclude_patterns: [] }));

    assert.equal(result.ok, true);
    assert.equal(result.total_size_bytes, 6);
    assert.equal(result.file_count, 1);
    assert.equal(result.folder_count, 0);
    assert.equal(result.warning_count, 1);
    assert.equal(result.warnings[0]?.code, "SYMLINK_SKIPPED");
    assert.equal(relativeOutputPath(rootPath, result.warnings[0]?.path ?? ""), "link-marker.bin");
  });
});

test("an injected permission failure is warned about while readable siblings continue", async () => {
  await withTempDirectory("disk-space-permission-", async (rootPath) => {
    const blockedPath = path.join(rootPath, "blocked");
    await writeSizedFile(path.join(blockedPath, "hidden.bin"), 50);
    await writeSizedFile(path.join(rootPath, "readable", "visible.bin"), 6);
    const injectedFileSystem: LocalFileSystem = {
      ...nodeFileSystem,
      readDirectory: (directoryPath: string): AsyncIterable<Dirent> => (async function* () {
        if (samePath(directoryPath, blockedPath)) {
          throw Object.assign(new Error("injected access denial"), { code: "EACCES" });
        }
        for await (const entry of nodeFileSystem.readDirectory(directoryPath)) {
          yield entry;
        }
      })()
    };
    const analyzer = new DiskSpaceAnalyzer(injectedFileSystem);

    const result = await analyzer.scanDirectory(scanInput(rootPath, { exclude_patterns: [] }));

    assert.equal(result.ok, true);
    assert.equal(result.total_size_bytes, 6);
    assert.equal(result.file_count, 1);
    assert.equal(result.folder_count, 2);
    assert.equal(result.warning_count, 1);
    assert.equal(result.warnings[0]?.code, "PERMISSION_DENIED");
    assert.equal(relativeOutputPath(rootPath, result.warnings[0]?.path ?? ""), "blocked");
  });
});

test("an injected canonical-path cycle is skipped without symlink privileges", async () => {
  await withTempDirectory("disk-space-cycle-", async (rootPath) => {
    const loopPath = path.join(rootPath, "loop");
    await writeSizedFile(path.join(rootPath, "visible.bin"), 4);
    await writeSizedFile(path.join(loopPath, "must-not-be-counted.bin"), 40);
    const injectedFileSystem: LocalFileSystem = {
      ...nodeFileSystem,
      realpath: async (candidatePath: string): Promise<string> => {
        if (samePath(candidatePath, loopPath)) {
          return rootPath;
        }
        return nodeFileSystem.realpath(candidatePath);
      }
    };
    const analyzer = new DiskSpaceAnalyzer(injectedFileSystem);

    const result = await analyzer.scanDirectory(scanInput(rootPath, { exclude_patterns: [] }));

    assert.equal(result.ok, true);
    assert.equal(result.total_size_bytes, 4);
    assert.equal(result.file_count, 1);
    assert.equal(result.folder_count, 1);
    assert.equal(result.warning_count, 1);
    assert.equal(result.warnings[0]?.code, "CYCLE_SKIPPED");
    assert.equal(relativeOutputPath(rootPath, result.warnings[0]?.path ?? ""), "loop");
  });
});

test("an ancestor cycle with a different canonical path is detected by device and inode", async () => {
  await withTempDirectory("disk-space-inode-cycle-", async (rootPath) => {
    const loopPath = path.join(rootPath, "loop");
    await writeSizedFile(path.join(rootPath, "visible.bin"), 4);
    await writeSizedFile(path.join(loopPath, "must-not-be-counted.bin"), 40);
    const injectedFileSystem: LocalFileSystem = {
      ...nodeFileSystem,
      lstat: async (candidatePath: string): Promise<Stats> => {
        const stats = await nodeFileSystem.lstat(candidatePath);
        return samePath(candidatePath, rootPath) || samePath(candidatePath, loopPath)
          ? withStatsValues(stats, { dev: 101, ino: 202 })
          : stats;
      }
    };
    const analyzer = new DiskSpaceAnalyzer(injectedFileSystem);

    const result = await analyzer.scanDirectory(scanInput(rootPath, { exclude_patterns: [] }));

    assert.equal(result.ok, true);
    assert.equal(result.total_size_bytes, 4);
    assert.equal(result.file_count, 1);
    assert.equal(result.warning_count, 1);
    assert.equal(result.warnings[0]?.code, "CYCLE_SKIPPED");
    assert.equal(relativeOutputPath(rootPath, result.warnings[0]?.path ?? ""), "loop");
  });
});

test("unsafe aggregate byte totals return a structured size_overflow error", async () => {
  await withTempDirectory("disk-space-overflow-", async (rootPath) => {
    const hugePath = path.join(rootPath, "huge.bin");
    const extraPath = path.join(rootPath, "extra.bin");
    await writeSizedFile(hugePath, 1);
    await writeSizedFile(extraPath, 1);
    const injectedFileSystem: LocalFileSystem = {
      ...nodeFileSystem,
      lstat: async (candidatePath: string): Promise<Stats> => {
        const stats = await nodeFileSystem.lstat(candidatePath);
        if (samePath(candidatePath, hugePath)) {
          return withStatsValues(stats, { size: Number.MAX_SAFE_INTEGER });
        }
        return stats;
      }
    };
    const analyzer = new DiskSpaceAnalyzer(injectedFileSystem);

    const result = await analyzer.scanDirectory(scanInput(rootPath, { exclude_patterns: [] }));

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "size_overflow");
    assert.equal(result.total_size_bytes, 0);
    assert.equal(result.file_count, 0);
  });
});

test("a directory identity change between metadata checks is skipped deterministically", async () => {
  await withTempDirectory("disk-space-identity-change-", async (rootPath) => {
    const changingPath = path.join(rootPath, "changing");
    await writeSizedFile(path.join(changingPath, "hidden.bin"), 30);
    let checks = 0;
    const injectedFileSystem: LocalFileSystem = {
      ...nodeFileSystem,
      lstat: async (candidatePath: string): Promise<Stats> => {
        const stats = await nodeFileSystem.lstat(candidatePath);
        if (samePath(candidatePath, changingPath)) {
          checks += 1;
          return withStatsValues(stats, { dev: 303, ino: checks === 1 ? 404 : 405 });
        }
        return stats;
      }
    };
    const analyzer = new DiskSpaceAnalyzer(injectedFileSystem);

    const result = await analyzer.scanDirectory(scanInput(rootPath, { exclude_patterns: [] }));

    assert.equal(result.ok, true);
    assert.equal(result.total_size_bytes, 0);
    assert.equal(result.file_count, 0);
    assert.equal(result.folder_count, 1);
    assert.equal(result.warning_count, 1);
    assert.equal(result.warnings[0]?.code, "READ_ERROR");
    assert.equal(relativeOutputPath(rootPath, result.warnings[0]?.path ?? ""), "changing");
  });
});
