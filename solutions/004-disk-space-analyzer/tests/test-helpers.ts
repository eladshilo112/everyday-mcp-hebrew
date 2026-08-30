import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  listLargestItemsInputSchema,
  scanDirectoryInputSchema
} from "../src/schemas.js";

export async function withTempDirectory<T>(
  prefix: string,
  callback: (rootPath: string) => Promise<T>
): Promise<T> {
  const temporaryPath = await mkdtemp(path.join(os.tmpdir(), prefix));
  const rootPath = await realpath(temporaryPath);
  try {
    return await callback(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}

export function scanInput(
  rootPath: string,
  overrides: { max_depth?: number; exclude_patterns?: string[] } = {}
) {
  return scanDirectoryInputSchema.parse({ path: rootPath, ...overrides });
}

export function listInput(
  overrides: { top_n?: number; item_type?: "all" | "file" | "directory" } = {}
) {
  return listLargestItemsInputSchema.parse(overrides);
}

export async function writeSizedFile(filePath: string, size: number): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.alloc(size, 97));
}

export function relativeOutputPath(rootPath: string, outputPath: string): string {
  const relativePath = path.isAbsolute(outputPath) ? path.relative(rootPath, outputPath) : outputPath;
  return relativePath.split(path.sep).join("/");
}

export function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
    : normalizedLeft === normalizedRight;
}
