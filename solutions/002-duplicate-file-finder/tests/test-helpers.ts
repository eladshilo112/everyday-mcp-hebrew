import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ScanDirectoryInput } from "../src/schemas.js";

export function scanInput(
  directoryPath: string,
  overrides: Partial<Omit<ScanDirectoryInput, "path">> = {}
): ScanDirectoryInput {
  return {
    path: directoryPath,
    max_depth: overrides.max_depth ?? 16,
    max_files: overrides.max_files ?? 10_000,
    max_file_size_bytes: overrides.max_file_size_bytes ?? 100 * 1024 * 1024
  };
}

export async function withTempDirectory<T>(
  prefix: string,
  callback: (directoryPath: string) => Promise<T>
): Promise<T> {
  const directoryPath = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await callback(directoryPath);
  } finally {
    await rm(directoryPath, { recursive: true, force: true });
  }
}

export async function snapshotFiles(rootPath: string): Promise<Array<{ path: string; sha256: string }>> {
  const output: Array<{ path: string; sha256: string }> = [];
  const walk = async (directoryPath: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relativePath = relativeDirectory.length === 0
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const content = await readFile(absolutePath);
        output.push({
          path: relativePath,
          sha256: createHash("sha256").update(content).digest("hex")
        });
      }
    }
  };
  await walk(rootPath, "");
  return output;
}
