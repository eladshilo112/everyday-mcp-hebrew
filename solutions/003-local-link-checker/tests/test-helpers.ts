import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function withTempDirectory(
  prefix: string,
  callback: (directoryPath: string) => Promise<void>
): Promise<void> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await callback(await realpath(directoryPath));
  } finally {
    await rm(directoryPath, { recursive: true, force: true });
  }
}
