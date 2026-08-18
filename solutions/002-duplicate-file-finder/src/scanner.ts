import { createHash } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type {
  ScanDirectoryInput,
  ScanDirectoryResult,
  ScanLimits,
  ScannedFile,
  SkippedEntry,
  ToolError
} from "./schemas.js";

const HASH_BUFFER_BYTES = 64 * 1024;
const MAX_RETAINED_SCANS = 16;

interface CandidateFile {
  absolutePath: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  dev: number;
  ino: number;
}

export interface ScanSession {
  scanId: string;
  rootPath: string;
  limits: ScanLimits;
  files: ScannedFile[];
  skipped: SkippedEntry[];
}

class FileLimitExceeded extends Error {}

const sessions = new Map<string, ScanSession>();
let latestScanId: string | null = null;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portableRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function toolError(code: ToolError["code"], message: string, filePath: string | null): ToolError {
  return { code, message, path: filePath };
}

function failure(
  limits: ScanLimits,
  error: ToolError,
  skipped: SkippedEntry[] = []
): ScanDirectoryResult {
  return {
    ok: false,
    error,
    scan_id: null,
    root_path: null,
    limits,
    files: [],
    skipped
  };
}

async function hashCandidate(
  candidate: CandidateFile,
  maxFileSizeBytes: number
): Promise<{ kind: "ok"; sha256: string; size: number } | { kind: "too_large" } | { kind: "changed" } | { kind: "error" }> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(candidate.absolutePath, "r");
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.dev !== candidate.dev ||
      before.ino !== candidate.ino ||
      before.size !== candidate.size ||
      before.mtimeMs !== candidate.mtimeMs
    ) {
      return { kind: "changed" };
    }
    if (before.size > maxFileSizeBytes) {
      return { kind: "too_large" };
    }

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(Math.min(HASH_BUFFER_BYTES, maxFileSizeBytes + 1));
    let totalBytes = 0;
    while (true) {
      const remainingBudget = maxFileSizeBytes + 1 - totalBytes;
      if (remainingBudget <= 0) {
        return { kind: "too_large" };
      }
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, remainingBudget),
        null
      );
      if (bytesRead === 0) {
        break;
      }
      totalBytes += bytesRead;
      if (totalBytes > maxFileSizeBytes) {
        return { kind: "too_large" };
      }
      hash.update(buffer.subarray(0, bytesRead));
    }

    const after = await handle.stat();
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      totalBytes !== after.size
    ) {
      return { kind: "changed" };
    }
    return { kind: "ok", sha256: hash.digest("hex"), size: totalBytes };
  } catch {
    return { kind: "error" };
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
  }
}

function makeScanId(
  rootPath: string,
  limits: ScanLimits,
  files: ScannedFile[],
  skipped: SkippedEntry[]
): string {
  const identity = JSON.stringify({ root_path: rootPath, limits, files, skipped });
  return createHash("sha256").update(identity, "utf8").digest("hex");
}

function retainSession(session: ScanSession): void {
  sessions.delete(session.scanId);
  sessions.set(session.scanId, session);
  latestScanId = session.scanId;
  while (sessions.size > MAX_RETAINED_SCANS) {
    const oldest = sessions.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    sessions.delete(oldest);
  }
}

export function getScanSession(scanId?: string): ScanSession | undefined {
  const selectedId = scanId ?? latestScanId ?? undefined;
  return selectedId === undefined ? undefined : sessions.get(selectedId);
}

export function hasAnyScanSession(): boolean {
  return latestScanId !== null;
}

export function clearScanSessionsForTests(): void {
  sessions.clear();
  latestScanId = null;
}

export async function scanDirectory(input: ScanDirectoryInput): Promise<ScanDirectoryResult> {
  const limits: ScanLimits = {
    max_depth: input.max_depth,
    max_files: input.max_files,
    max_file_size_bytes: input.max_file_size_bytes
  };
  if (input.path.trim().length === 0) {
    return failure(limits, toolError("invalid_path", "Directory path must not be empty.", input.path));
  }

  const requestedPath = path.resolve(input.path);
  let rootStats: Stats;
  try {
    rootStats = await lstat(requestedPath);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      return failure(limits, toolError("not_found", "Directory path does not exist.", requestedPath));
    }
    if (code === "EACCES" || code === "EPERM") {
      return failure(
        limits,
        toolError("permission_denied", "Directory path cannot be read with the current permissions.", requestedPath)
      );
    }
    return failure(limits, toolError("scan_failed", "Directory path could not be inspected.", requestedPath));
  }

  if (rootStats.isSymbolicLink()) {
    return failure(
      limits,
      toolError("root_symlink", "The scan root must be a real directory, not a symbolic link.", requestedPath)
    );
  }
  if (!rootStats.isDirectory()) {
    return failure(limits, toolError("not_directory", "The supplied path is not a directory.", requestedPath));
  }

  let rootPath: string;
  try {
    rootPath = await realpath(requestedPath);
  } catch {
    return failure(limits, toolError("scan_failed", "Directory path could not be resolved.", requestedPath));
  }

  const candidates: CandidateFile[] = [];
  const skipped: SkippedEntry[] = [];
  let encounteredFiles = 0;

  const walk = async (directoryPath: string, relativeDirectory: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      if (relativeDirectory.length === 0) {
        throw error;
      }
      skipped.push({ path: portableRelativePath(relativeDirectory), reason: "read_error" });
      return;
    }
    entries.sort((left, right) => compareText(left.name, right.name));

    for (const entry of entries) {
      const relativePath = relativeDirectory.length === 0
        ? entry.name
        : path.join(relativeDirectory, entry.name);
      const portablePath = portableRelativePath(relativePath);
      const absolutePath = path.join(directoryPath, entry.name);

      let stats;
      try {
        stats = await lstat(absolutePath);
      } catch {
        skipped.push({ path: portablePath, reason: "read_error" });
        continue;
      }
      if (stats.isSymbolicLink()) {
        skipped.push({ path: portablePath, reason: "symlink" });
        continue;
      }
      if (stats.isDirectory()) {
        if (depth >= limits.max_depth) {
          skipped.push({ path: portablePath, reason: "max_depth" });
        } else {
          await walk(absolutePath, relativePath, depth + 1);
        }
        continue;
      }
      if (!stats.isFile()) {
        skipped.push({ path: portablePath, reason: "unsupported_type" });
        continue;
      }

      encounteredFiles += 1;
      if (encounteredFiles > limits.max_files) {
        throw new FileLimitExceeded();
      }
      if (stats.size > limits.max_file_size_bytes) {
        skipped.push({ path: portablePath, reason: "too_large" });
        continue;
      }
      candidates.push({
        absolutePath,
        relativePath: portablePath,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        dev: stats.dev,
        ino: stats.ino
      });
    }
  };

  try {
    await walk(rootPath, "", 0);
  } catch (error) {
    if (error instanceof FileLimitExceeded) {
      return failure(
        limits,
        toolError(
          "limit_exceeded",
          `Scan stopped after the configured limit of ${limits.max_files} regular files was exceeded.`,
          rootPath
        ),
        skipped
      );
    }
    const code = errorCode(error);
    const permissionError = code === "EACCES" || code === "EPERM";
    return failure(
      limits,
      toolError(
        permissionError ? "permission_denied" : "scan_failed",
        permissionError ? "Directory contents cannot be read with the current permissions." : "Directory scan failed safely.",
        rootPath
      ),
      skipped
    );
  }

  const files: ScannedFile[] = [];
  for (const candidate of candidates) {
    const outcome = await hashCandidate(candidate, limits.max_file_size_bytes);
    if (outcome.kind === "ok") {
      files.push({ path: candidate.relativePath, size_bytes: outcome.size, sha256: outcome.sha256 });
    } else if (outcome.kind === "too_large") {
      skipped.push({ path: candidate.relativePath, reason: "too_large" });
    } else if (outcome.kind === "changed") {
      skipped.push({ path: candidate.relativePath, reason: "changed_during_scan" });
    } else {
      skipped.push({ path: candidate.relativePath, reason: "read_error" });
    }
  }

  files.sort((left, right) => compareText(left.path, right.path));
  skipped.sort((left, right) => compareText(left.path, right.path) || compareText(left.reason, right.reason));
  const scanId = makeScanId(rootPath, limits, files, skipped);
  const session: ScanSession = {
    scanId,
    rootPath,
    limits: { ...limits },
    files: files.map((file) => ({ ...file })),
    skipped: skipped.map((entry) => ({ ...entry }))
  };
  retainSession(session);

  return {
    ok: true,
    error: null,
    scan_id: scanId,
    root_path: rootPath,
    limits,
    files,
    skipped
  };
}
