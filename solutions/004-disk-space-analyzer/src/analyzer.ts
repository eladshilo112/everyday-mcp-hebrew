import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import { lstat, opendir, realpath } from "node:fs/promises";
import {
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_MAX_DEPTH,
  MAX_RETAINED_WARNINGS,
  MAX_TOP_N
} from "./schemas.js";
import type {
  GetScanSummaryResult,
  LargestItem,
  ListLargestItemsInput,
  ListLargestItemsResult,
  ScanDirectoryInput,
  ScanDirectoryResult,
  ScanWarning,
  ToolError,
  WarningCode
} from "./schemas.js";

export interface LocalFileSystem {
  lstat(filePath: string): Promise<Stats>;
  realpath(filePath: string): Promise<string>;
  readDirectory(directoryPath: string): AsyncIterable<Dirent>;
}

export const nodeFileSystem: LocalFileSystem = {
  lstat: async (filePath) => lstat(filePath),
  realpath: async (filePath) => realpath(filePath),
  async *readDirectory(directoryPath) {
    const directory = await opendir(directoryPath);
    for await (const entry of directory) {
      yield entry;
    }
  }
};

interface DirectoryAggregate {
  sizeBytes: number;
  complete: boolean;
}

interface StoredScan {
  summary: ScanDirectoryResult;
  files: LargestItem[];
  directories: LargestItem[];
}

interface ScanContext {
  rootPath: string;
  maxDepth: number;
  excludeMatcher: ExcludeMatcher;
  activeDirectoryKeys: Set<string>;
  topFiles: TopItemCollector;
  topDirectories: TopItemCollector;
  warnings: WarningCollector;
  fileCount: number;
  folderCount: number;
  excludedCount: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareItems(left: LargestItem, right: LargestItem): number {
  return (
    right.size_bytes - left.size_bytes ||
    compareText(left.path, right.path) ||
    compareText(left.type, right.type)
  );
}

function compareWarnings(left: ScanWarning, right: ScanWarning): number {
  return compareText(left.path, right.path) || compareText(left.code, right.code);
}

function portable(value: string): string {
  return value.split(path.sep).join("/");
}

function displayPath(relativePath: string): string {
  return relativePath.length === 0 ? "." : portable(relativePath);
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "UNKNOWN";
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "UNKNOWN";
}

function isPermissionError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EACCES" || code === "EPERM";
}

function isWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative.length === 0 ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function canonicalKey(canonicalPath: string): string {
  const normalized = path.resolve(canonicalPath);
  return `path:${process.platform === "win32" ? normalized.toLowerCase() : normalized}`;
}

function inodeKey(stats: Stats): string | null {
  if (
    !Number.isSafeInteger(stats.dev) ||
    !Number.isSafeInteger(stats.ino) ||
    stats.ino === 0
  ) {
    return null;
  }
  return `inode:${stats.dev}:${stats.ino}`;
}

function directoryKeys(canonicalPath: string, stats: Stats): string[] {
  const keys = [canonicalKey(canonicalPath)];
  const inode = inodeKey(stats);
  if (inode !== null) {
    keys.push(inode);
  }
  return keys;
}

function sameIdentity(left: Stats, right: Stats): boolean {
  const leftInode = inodeKey(left);
  const rightInode = inodeKey(right);
  return leftInode === null || rightInode === null || leftInode === rightInode;
}

class SizeOverflowError extends Error {}

function addSizes(left: number, right: number): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    left < 0 ||
    right < 0 ||
    left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw new SizeOverflowError("Logical byte total exceeds the safe integer range.");
  }
  return left + right;
}

function normalizePatterns(patterns: string[]): string[] {
  return [...new Set(patterns.map((pattern) => portable(pattern.trim()).replace(/^\.\//u, "")))]
    .filter((pattern) => pattern.length > 0)
    .sort(compareText);
}

const REGEXP_SPECIAL_CHARACTERS = new Set(["\\", "^", "$", ".", "+", "(", ")", "[", "]", "{", "}", "|"]);

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? "";
    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += REGEXP_SPECIAL_CHARACTERS.has(character) ? `\\${character}` : character;
    }
  }
  return new RegExp(`^${source}$`, "u");
}

class ExcludeMatcher {
  readonly patterns: string[];
  private readonly compiled: Array<{ useRelativePath: boolean; expression: RegExp }>;

  constructor(patterns: string[]) {
    this.patterns = normalizePatterns(patterns);
    this.compiled = this.patterns.map((pattern) => ({
      useRelativePath: pattern.includes("/"),
      expression: globToRegExp(pattern)
    }));
  }

  matches(name: string, relativePath: string): boolean {
    const portableRelativePath = portable(relativePath);
    return this.compiled.some(({ useRelativePath, expression }) =>
      expression.test(useRelativePath ? portableRelativePath : name)
    );
  }
}

class TopItemCollector {
  private readonly retained: LargestItem[] = [];

  add(item: LargestItem): void {
    this.retained.push(item);
    this.retained.sort(compareItems);
    if (this.retained.length > MAX_TOP_N) {
      this.retained.pop();
    }
  }

  values(): LargestItem[] {
    return this.retained.map((item) => ({ ...item }));
  }
}

class WarningCollector {
  private readonly retained: ScanWarning[] = [];
  count = 0;

  add(warning: ScanWarning): void {
    this.count += 1;
    this.retained.push(warning);
    this.retained.sort(compareWarnings);
    if (this.retained.length > MAX_RETAINED_WARNINGS) {
      this.retained.pop();
    }
  }

  values(): ScanWarning[] {
    return this.retained.map((warning) => ({ ...warning }));
  }

  omitted(): number {
    return this.count - this.retained.length;
  }
}

const WARNING_MESSAGES: Record<WarningCode, string> = {
  SYMLINK_SKIPPED: "Symbolic link skipped; links are never followed.",
  CYCLE_SKIPPED: "Directory cycle back to an active ancestor skipped.",
  PERMISSION_DENIED: "Path could not be inspected with the current permissions.",
  READ_ERROR: "Path metadata or directory entries could not be read.",
  MAX_DEPTH_REACHED: "Directory contents skipped because the maximum depth was reached.",
  OUTSIDE_ROOT_SKIPPED: "Resolved directory is outside the requested root and was skipped.",
  UNSUPPORTED_TYPE: "Non-file, non-directory filesystem entry skipped."
};

function warning(code: WarningCode, relativePath: string): ScanWarning {
  return { path: displayPath(relativePath), code, message: WARNING_MESSAGES[code] };
}

function toolError(code: ToolError["code"], message: string, filePath: string | null): ToolError {
  return { code, message, path: filePath };
}

function summaryText(
  fileCount: number,
  folderCount: number,
  totalSizeBytes: number,
  warningCount: number,
  warningsOmitted: number
): string {
  const retainedNote = warningsOmitted > 0 ? ` מתוכן ${warningsOmitted} אזהרות לא פורטו.` : "";
  return `נסרקו ${fileCount} קבצים ו־${folderCount} תיקיות, בגודל כולל של ${totalSizeBytes} בתים. נרשמו ${warningCount} אזהרות.${retainedNote}`;
}

function cloneSummary(summary: ScanDirectoryResult): ScanDirectoryResult {
  return {
    ...summary,
    exclude_patterns: [...summary.exclude_patterns],
    error: summary.error === null ? null : { ...summary.error },
    warnings: summary.warnings.map((item) => ({ ...item }))
  };
}

function failureSummary(
  error: ToolError,
  maxDepth: number,
  excludePatterns: string[]
): ScanDirectoryResult {
  return {
    ok: false,
    error,
    root_path: null,
    max_depth: maxDepth,
    exclude_patterns: [...excludePatterns],
    total_size_bytes: 0,
    file_count: 0,
    folder_count: 0,
    excluded_count: 0,
    warning_count: 0,
    warnings_omitted: 0,
    warnings: [],
    summary_text: `הסריקה לא בוצעה: ${error.message}`
  };
}

export class DiskSpaceAnalyzer {
  private latestScan: StoredScan | null = null;

  constructor(private readonly fs: LocalFileSystem = nodeFileSystem) {}

  async scanDirectory(input: ScanDirectoryInput): Promise<ScanDirectoryResult> {
    const matcher = new ExcludeMatcher(input.exclude_patterns);
    if (input.path.trim().length === 0 || input.path.includes("\0")) {
      return failureSummary(
        toolError("invalid_path", "Directory path must contain a valid local path.", input.path),
        input.max_depth,
        matcher.patterns
      );
    }

    const requestedPath = path.resolve(input.path);
    let rootStats: Stats;
    try {
      rootStats = await this.fs.lstat(requestedPath);
    } catch (error) {
      const code = errorCode(error);
      const structuredError = code === "ENOENT"
        ? toolError("not_found", "Directory path does not exist.", portable(requestedPath))
        : isPermissionError(error)
          ? toolError("permission_denied", "Directory path cannot be inspected with the current permissions.", portable(requestedPath))
          : toolError("scan_failed", "Directory path could not be inspected.", portable(requestedPath));
      return failureSummary(structuredError, input.max_depth, matcher.patterns);
    }

    if (rootStats.isSymbolicLink()) {
      return failureSummary(
        toolError("root_symlink", "The scan root must not be a symbolic link.", portable(requestedPath)),
        input.max_depth,
        matcher.patterns
      );
    }
    if (!rootStats.isDirectory()) {
      return failureSummary(
        toolError("not_directory", "The requested path is not a directory.", portable(requestedPath)),
        input.max_depth,
        matcher.patterns
      );
    }

    let rootPath: string;
    try {
      rootPath = await this.fs.realpath(requestedPath);
    } catch (error) {
      const structuredError = isPermissionError(error)
        ? toolError("permission_denied", "Directory path cannot be resolved with the current permissions.", portable(requestedPath))
        : toolError("scan_failed", "Directory path could not be resolved.", portable(requestedPath));
      return failureSummary(structuredError, input.max_depth, matcher.patterns);
    }

    let verifiedRootStats: Stats;
    try {
      verifiedRootStats = await this.fs.lstat(requestedPath);
    } catch (error) {
      const structuredError = isPermissionError(error)
        ? toolError("permission_denied", "Directory path cannot be verified with the current permissions.", portable(requestedPath))
        : toolError("scan_failed", "Directory path changed before it could be scanned.", portable(requestedPath));
      return failureSummary(structuredError, input.max_depth, matcher.patterns);
    }
    if (verifiedRootStats.isSymbolicLink()) {
      return failureSummary(
        toolError("root_symlink", "The scan root must not be a symbolic link.", portable(requestedPath)),
        input.max_depth,
        matcher.patterns
      );
    }
    if (!verifiedRootStats.isDirectory() || !sameIdentity(rootStats, verifiedRootStats)) {
      return failureSummary(
        toolError("scan_failed", "Directory path changed before it could be scanned.", portable(requestedPath)),
        input.max_depth,
        matcher.patterns
      );
    }

    const rootDirectoryKeys = directoryKeys(rootPath, verifiedRootStats);

    const context: ScanContext = {
      rootPath,
      maxDepth: input.max_depth,
      excludeMatcher: matcher,
      activeDirectoryKeys: new Set(rootDirectoryKeys),
      topFiles: new TopItemCollector(),
      topDirectories: new TopItemCollector(),
      warnings: new WarningCollector(),
      fileCount: 0,
      folderCount: 0,
      excludedCount: 0
    };

    let aggregate: DirectoryAggregate;
    try {
      aggregate = await this.walkDirectory(context, rootPath, "", 0, true);
    } catch (error) {
      const structuredError = error instanceof SizeOverflowError
        ? toolError("size_overflow", error.message, portable(rootPath))
        : isPermissionError(error)
          ? toolError("permission_denied", "Scan root cannot be read with the current permissions.", portable(rootPath))
          : toolError("scan_failed", "Scan root could not be read.", portable(rootPath));
      return failureSummary(structuredError, input.max_depth, matcher.patterns);
    }

    const warnings = context.warnings.values();
    const warningsOmitted = context.warnings.omitted();
    const summary: ScanDirectoryResult = {
      ok: true,
      error: null,
      root_path: portable(rootPath),
      max_depth: input.max_depth,
      exclude_patterns: [...matcher.patterns],
      total_size_bytes: aggregate.sizeBytes,
      file_count: context.fileCount,
      folder_count: context.folderCount,
      excluded_count: context.excludedCount,
      warning_count: context.warnings.count,
      warnings_omitted: warningsOmitted,
      warnings,
      summary_text: summaryText(
        context.fileCount,
        context.folderCount,
        aggregate.sizeBytes,
        context.warnings.count,
        warningsOmitted
      )
    };

    this.latestScan = {
      summary: cloneSummary(summary),
      files: context.topFiles.values(),
      directories: context.topDirectories.values()
    };
    return cloneSummary(summary);
  }

  listLargestItems(input: ListLargestItemsInput): ListLargestItemsResult {
    if (this.latestScan === null) {
      const error = toolError("no_scan", "Run scan_directory successfully before listing items.", null);
      return {
        ok: false,
        error,
        root_path: null,
        top_n: input.top_n,
        item_type: input.item_type,
        items: [],
        returned_count: 0,
        summary_text: `לא ניתן להציג פריטים: ${error.message}`
      };
    }

    const candidates = input.item_type === "file"
      ? this.latestScan.files
      : input.item_type === "directory"
        ? this.latestScan.directories
        : [...this.latestScan.files, ...this.latestScan.directories];
    const items = candidates
      .map((item) => ({ ...item }))
      .sort(compareItems)
      .slice(0, input.top_n);
    return {
      ok: true,
      error: null,
      root_path: this.latestScan.summary.root_path,
      top_n: input.top_n,
      item_type: input.item_type,
      items,
      returned_count: items.length,
      summary_text: `הוחזרו ${items.length} פריטים, ממוינים לפי גודל בסדר יורד ולאחר מכן לפי נתיב.`
    };
  }

  getScanSummary(): GetScanSummaryResult {
    if (this.latestScan !== null) {
      return cloneSummary(this.latestScan.summary);
    }
    return failureSummary(
      toolError("no_scan", "No successful scan is available in this server process.", null),
      DEFAULT_MAX_DEPTH,
      [...DEFAULT_EXCLUDE_PATTERNS]
    );
  }

  private async walkDirectory(
    context: ScanContext,
    directoryPath: string,
    relativeDirectory: string,
    depth: number,
    isRoot: boolean
  ): Promise<DirectoryAggregate> {
    let sizeBytes = 0;
    let complete = true;
    try {
      for await (const entry of this.fs.readDirectory(directoryPath)) {
        const relativePath = relativeDirectory.length === 0
          ? entry.name
          : path.join(relativeDirectory, entry.name);
        if (context.excludeMatcher.matches(entry.name, relativePath)) {
          context.excludedCount += 1;
          continue;
        }

        const absolutePath = path.join(directoryPath, entry.name);
        let stats: Stats;
        try {
          stats = await this.fs.lstat(absolutePath);
        } catch (error) {
          const code: WarningCode = isPermissionError(error) ? "PERMISSION_DENIED" : "READ_ERROR";
          context.warnings.add(warning(code, relativePath));
          complete = false;
          continue;
        }

        if (stats.isSymbolicLink()) {
          context.warnings.add(warning("SYMLINK_SKIPPED", relativePath));
          complete = false;
          continue;
        }

        if (stats.isFile()) {
          sizeBytes = addSizes(sizeBytes, stats.size);
          const item: LargestItem = {
            path: displayPath(relativePath),
            type: "file",
            size_bytes: stats.size,
            complete: true
          };
          context.fileCount += 1;
          context.topFiles.add(item);
          continue;
        }

        if (stats.isDirectory()) {
          context.folderCount += 1;
          if (depth >= context.maxDepth) {
            context.warnings.add(warning("MAX_DEPTH_REACHED", relativePath));
            context.topDirectories.add({
              path: displayPath(relativePath),
              type: "directory",
              size_bytes: 0,
              complete: false
            });
            complete = false;
            continue;
          }

          let canonicalPath: string;
          try {
            canonicalPath = await this.fs.realpath(absolutePath);
          } catch (error) {
            const code: WarningCode = isPermissionError(error) ? "PERMISSION_DENIED" : "READ_ERROR";
            context.warnings.add(warning(code, relativePath));
            context.topDirectories.add({
              path: displayPath(relativePath),
              type: "directory",
              size_bytes: 0,
              complete: false
            });
            complete = false;
            continue;
          }

          let verifiedStats: Stats;
          try {
            verifiedStats = await this.fs.lstat(absolutePath);
          } catch (error) {
            const code: WarningCode = isPermissionError(error) ? "PERMISSION_DENIED" : "READ_ERROR";
            context.warnings.add(warning(code, relativePath));
            context.topDirectories.add({
              path: displayPath(relativePath),
              type: "directory",
              size_bytes: 0,
              complete: false
            });
            complete = false;
            continue;
          }
          if (verifiedStats.isSymbolicLink()) {
            context.warnings.add(warning("SYMLINK_SKIPPED", relativePath));
            context.topDirectories.add({
              path: displayPath(relativePath),
              type: "directory",
              size_bytes: 0,
              complete: false
            });
            complete = false;
            continue;
          }
          if (!verifiedStats.isDirectory() || !sameIdentity(stats, verifiedStats)) {
            context.warnings.add(warning("READ_ERROR", relativePath));
            context.topDirectories.add({
              path: displayPath(relativePath),
              type: "directory",
              size_bytes: 0,
              complete: false
            });
            complete = false;
            continue;
          }

          if (!isWithin(context.rootPath, canonicalPath)) {
            context.warnings.add(warning("OUTSIDE_ROOT_SKIPPED", relativePath));
            context.topDirectories.add({
              path: displayPath(relativePath),
              type: "directory",
              size_bytes: 0,
              complete: false
            });
            complete = false;
            continue;
          }
          const childDirectoryKeys = directoryKeys(canonicalPath, verifiedStats);
          if (childDirectoryKeys.some((key) => context.activeDirectoryKeys.has(key))) {
            context.warnings.add(warning("CYCLE_SKIPPED", relativePath));
            context.topDirectories.add({
              path: displayPath(relativePath),
              type: "directory",
              size_bytes: 0,
              complete: false
            });
            complete = false;
            continue;
          }

          for (const key of childDirectoryKeys) {
            context.activeDirectoryKeys.add(key);
          }
          const child = await (async (): Promise<DirectoryAggregate> => {
            try {
              return await this.walkDirectory(
                context,
                canonicalPath,
                relativePath,
                depth + 1,
                false
              );
            } finally {
              for (const key of childDirectoryKeys) {
                context.activeDirectoryKeys.delete(key);
              }
            }
          })();
          context.topDirectories.add({
            path: displayPath(relativePath),
            type: "directory",
            size_bytes: child.sizeBytes,
            complete: child.complete
          });
          sizeBytes = addSizes(sizeBytes, child.sizeBytes);
          complete = complete && child.complete;
          continue;
        }

        context.warnings.add(warning("UNSUPPORTED_TYPE", relativePath));
        complete = false;
      }
    } catch (error) {
      if (error instanceof SizeOverflowError) {
        throw error;
      }
      if (isRoot) {
        throw error;
      }
      const code: WarningCode = isPermissionError(error) ? "PERMISSION_DENIED" : "READ_ERROR";
      context.warnings.add(warning(code, relativeDirectory));
      complete = false;
    }
    return { sizeBytes, complete };
  }
}
