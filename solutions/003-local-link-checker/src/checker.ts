import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import type {
  CheckMarkdownFileInput,
  CheckMarkdownFileResult,
  Finding,
  LinkCheckResult,
  ReadError,
  ScanMarkdownLinksInput,
  ScanMarkdownLinksResult,
  ToolError
} from "./schemas.js";

export interface LocalFileSystem {
  lstat(filePath: string): Promise<Stats>;
  readFile(filePath: string, encoding: "utf8"): Promise<string>;
  readdir(directoryPath: string): Promise<Dirent[]>;
  realpath(filePath: string): Promise<string>;
}

export const nodeFileSystem: LocalFileSystem = {
  lstat: async (filePath) => lstat(filePath),
  readFile: async (filePath, encoding) => readFile(filePath, encoding),
  readdir: async (directoryPath) => readdir(directoryPath, { withFileTypes: true }),
  realpath: async (filePath) => realpath(filePath)
};

interface ExtractedLink {
  line: number;
  target: string;
}

interface ResolvedRequest {
  absolutePath: string;
  displayPath: string;
}

interface CheckContext {
  baseDirectory: string;
  fs: LocalFileSystem;
  contentCache: Map<string, string | null>;
  readErrors: Map<string, ReadError>;
  findings: Finding[];
  filesScanned: number;
  linksChecked: number;
  externalLinksSkipped: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portable(value: string): string {
  return value.split(path.sep).join("/");
}

function displayPath(baseDirectory: string, absolutePath: string): string {
  const relative = path.relative(baseDirectory, absolutePath);
  return relative.length === 0 ? "." : portable(relative);
}

function isWithin(baseDirectory: string, candidate: string): boolean {
  const relative = path.relative(baseDirectory, candidate);
  return (
    relative.length === 0 ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "UNKNOWN";
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "UNKNOWN";
}

function toolError(code: ToolError["code"], message: string, filePath: string | null): ToolError {
  return { code, message, path: filePath };
}

function emptyResult(
  baseDirectory: string,
  requestedPath: string | null,
  error: ToolError
): LinkCheckResult {
  return {
    ok: false,
    error,
    base_path: baseDirectory,
    requested_path: requestedPath,
    files_scanned: 0,
    links_checked: 0,
    external_links_skipped: 0,
    findings: [],
    read_errors: []
  };
}

function isMarkdownFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".md" || extension === ".markdown";
}

async function resolveRequest(
  baseDirectory: string,
  requestedPath: string | undefined,
  expected: "directory" | "file",
  fs: LocalFileSystem
): Promise<ResolvedRequest | LinkCheckResult> {
  if (requestedPath === undefined) {
    return emptyResult(
      baseDirectory,
      null,
      toolError("missing_path", "A local path is required.", null)
    );
  }
  if (requestedPath.trim().length === 0 || requestedPath.includes("\0")) {
    return emptyResult(
      baseDirectory,
      requestedPath,
      toolError("invalid_path", "The local path is empty or invalid.", requestedPath)
    );
  }

  const lexicalPath = path.resolve(baseDirectory, requestedPath);
  if (!isWithin(baseDirectory, lexicalPath)) {
    return emptyResult(
      baseDirectory,
      requestedPath,
      toolError("outside_base", "The requested path is outside the approved base directory.", requestedPath)
    );
  }

  let stats: Stats;
  try {
    stats = await fs.lstat(lexicalPath);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      return emptyResult(
        baseDirectory,
        requestedPath,
        toolError("not_found", "The requested path does not exist.", requestedPath)
      );
    }
    if (code === "EACCES" || code === "EPERM") {
      return emptyResult(
        baseDirectory,
        requestedPath,
        toolError("permission_denied", "The requested path cannot be inspected.", requestedPath)
      );
    }
    return emptyResult(
      baseDirectory,
      requestedPath,
      toolError("invalid_path", "The requested path could not be inspected.", requestedPath)
    );
  }

  let canonicalPath: string;
  try {
    canonicalPath = await fs.realpath(lexicalPath);
  } catch {
    return emptyResult(
      baseDirectory,
      requestedPath,
      toolError("invalid_path", "The requested path could not be resolved.", requestedPath)
    );
  }
  if (!isWithin(baseDirectory, canonicalPath)) {
    return emptyResult(
      baseDirectory,
      requestedPath,
      toolError("outside_base", "The resolved path is outside the approved base directory.", requestedPath)
    );
  }

  if (expected === "directory" && !stats.isDirectory()) {
    return emptyResult(
      baseDirectory,
      requestedPath,
      toolError("not_directory", "The requested path is not a directory.", requestedPath)
    );
  }
  if (expected === "file" && !stats.isFile()) {
    return emptyResult(
      baseDirectory,
      requestedPath,
      toolError("not_file", "The requested path is not a regular file.", requestedPath)
    );
  }
  if (expected === "file" && !isMarkdownFile(canonicalPath)) {
    return emptyResult(
      baseDirectory,
      requestedPath,
      toolError("not_markdown", "The requested file must end in .md or .markdown.", requestedPath)
    );
  }

  return { absolutePath: canonicalPath, displayPath: displayPath(baseDirectory, canonicalPath) };
}

function destinationFromInline(rawDestination: string): string | null {
  const trimmed = rawDestination.trim();
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    return end > 0 ? trimmed.slice(1, end) : null;
  }
  const match = /^(\S+?)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/u.exec(trimmed);
  return match?.[1] ?? null;
}

function extractLinks(content: string): ExtractedLink[] {
  const lines = content.split(/\r?\n/u);
  const definitions = new Map<string, { target: string; line: number }>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/u.exec(line);
    const target = match?.[2] ?? match?.[3];
    if (match?.[1] !== undefined && target !== undefined) {
      definitions.set(match[1].trim().toLowerCase(), { target, line: index + 1 });
    }
  }

  const links: ExtractedLink[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const inlinePattern = /!?\[[^\]]*\]\(([^)]*)\)/gu;
    for (const match of line.matchAll(inlinePattern)) {
      const target = destinationFromInline(match[1] ?? "");
      links.push({ line: index + 1, target: target ?? (match[1] ?? "").trim() });
    }

    const referencePattern = /!?\[([^\]]+)\]\[([^\]]*)\]/gu;
    for (const match of line.matchAll(referencePattern)) {
      const label = (match[2]?.length ?? 0) > 0 ? match[2] : match[1];
      const definition = definitions.get((label ?? "").trim().toLowerCase());
      if (definition !== undefined) {
        links.push({ line: index + 1, target: definition.target });
      }
    }
  }
  return links;
}

function isExternalTarget(target: string): boolean {
  if (target.startsWith("//")) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/u.test(target)) {
    return false;
  }
  return /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target);
}

function markdownAnchor(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>]*>/gu, "")
    .replace(/[`*_~]/gu, "")
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
}

function documentAnchors(content: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  for (const line of content.split(/\r?\n/u)) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1];
    if (heading !== undefined) {
      const base = markdownAnchor(heading);
      if (base.length > 0) {
        const count = counts.get(base) ?? 0;
        anchors.add(count === 0 ? base : `${base}-${count}`);
        counts.set(base, count + 1);
      }
    }
    for (const match of line.matchAll(/<(?:a|[^>]+)\s+(?:id|name)=["']([^"']+)["'][^>]*>/giu)) {
      const explicit = match[1];
      if (explicit !== undefined) {
        anchors.add(explicit);
      }
    }
  }
  return anchors;
}

function unescapeMarkdownTarget(target: string): string {
  return target.replace(/\\([\\()[\] ])/gu, "$1");
}

function addFinding(
  context: CheckContext,
  source: string,
  link: ExtractedLink,
  issue: Finding["issue"]
): void {
  const suggestions: Record<Finding["issue"], string> = {
    missing_target: "בדקו את הנתיב היחסי או עדכנו את שם היעד.",
    missing_anchor: "בדקו את כותרת היעד ועדכנו את העוגן בהתאם.",
    unauthorized_target: "השאירו את הקישור בתוך תיקיית הבסיס שאושרה.",
    invalid_target: "תקנו את תחביר היעד או את קידוד האחוזים."
  };
  context.findings.push({
    source,
    line: link.line,
    target: link.target,
    issue,
    suggestion: suggestions[issue]
  });
}

function addReadError(context: CheckContext, absolutePath: string, error: unknown): void {
  const source = displayPath(context.baseDirectory, absolutePath);
  if (!context.readErrors.has(source)) {
    const code = errorCode(error);
    context.readErrors.set(source, {
      source,
      code,
      message: code === "EACCES" || code === "EPERM"
        ? "The Markdown file cannot be read with the current permissions."
        : "The Markdown file could not be read."
    });
  }
}

async function loadDocument(context: CheckContext, absolutePath: string): Promise<string | null> {
  if (context.contentCache.has(absolutePath)) {
    return context.contentCache.get(absolutePath) ?? null;
  }
  try {
    const content = await context.fs.readFile(absolutePath, "utf8");
    context.contentCache.set(absolutePath, content);
    return content;
  } catch (error) {
    context.contentCache.set(absolutePath, null);
    addReadError(context, absolutePath, error);
    return null;
  }
}

async function checkLink(
  context: CheckContext,
  sourceAbsolutePath: string,
  sourceDisplayPath: string,
  link: ExtractedLink
): Promise<void> {
  const rawTarget = unescapeMarkdownTarget(link.target.trim());
  if (rawTarget.length === 0) {
    context.linksChecked += 1;
    addFinding(context, sourceDisplayPath, link, "invalid_target");
    return;
  }
  if (isExternalTarget(rawTarget)) {
    context.externalLinksSkipped += 1;
    return;
  }
  context.linksChecked += 1;

  const hashIndex = rawTarget.indexOf("#");
  const rawPathPart = hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget;
  const rawFragment = hashIndex >= 0 ? rawTarget.slice(hashIndex + 1) : null;
  const rawPathWithoutQuery = rawPathPart.split("?", 1)[0] ?? "";

  let decodedPath: string;
  let decodedFragment: string | null;
  try {
    decodedPath = decodeURIComponent(rawPathWithoutQuery);
    decodedFragment = rawFragment === null ? null : decodeURIComponent(rawFragment);
  } catch {
    addFinding(context, sourceDisplayPath, link, "invalid_target");
    return;
  }

  const targetAbsolutePath = decodedPath.length === 0
    ? sourceAbsolutePath
    : path.resolve(path.dirname(sourceAbsolutePath), decodedPath);
  if (!isWithin(context.baseDirectory, targetAbsolutePath)) {
    addFinding(context, sourceDisplayPath, link, "unauthorized_target");
    return;
  }

  let targetStats: Stats;
  try {
    targetStats = await context.fs.lstat(targetAbsolutePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      addFinding(context, sourceDisplayPath, link, "missing_target");
    } else {
      addReadError(context, targetAbsolutePath, error);
    }
    return;
  }

  let canonicalTarget: string;
  try {
    canonicalTarget = await context.fs.realpath(targetAbsolutePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      addFinding(context, sourceDisplayPath, link, "missing_target");
    } else {
      addReadError(context, targetAbsolutePath, error);
    }
    return;
  }
  if (!isWithin(context.baseDirectory, canonicalTarget)) {
    addFinding(context, sourceDisplayPath, link, "unauthorized_target");
    return;
  }

  if (decodedFragment === null || decodedFragment.length === 0) {
    return;
  }
  if (!targetStats.isFile() || !isMarkdownFile(canonicalTarget)) {
    addFinding(context, sourceDisplayPath, link, "missing_anchor");
    return;
  }

  const targetContent = await loadDocument(context, canonicalTarget);
  if (targetContent === null) {
    return;
  }
  const anchors = documentAnchors(targetContent);
  const normalizedFragment = markdownAnchor(decodedFragment);
  if (!anchors.has(decodedFragment) && !anchors.has(normalizedFragment)) {
    addFinding(context, sourceDisplayPath, link, "missing_anchor");
  }
}

async function inspectMarkdownFile(context: CheckContext, absolutePath: string): Promise<void> {
  const content = await loadDocument(context, absolutePath);
  if (content === null) {
    return;
  }
  context.filesScanned += 1;
  const source = displayPath(context.baseDirectory, absolutePath);
  for (const link of extractLinks(content)) {
    await checkLink(context, absolutePath, source, link);
  }
}

async function collectMarkdownFiles(
  context: CheckContext,
  directoryPath: string,
  collected: string[]
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await context.fs.readdir(directoryPath);
  } catch (error) {
    addReadError(context, directoryPath, error);
    return;
  }
  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    let stats: Stats;
    try {
      stats = await context.fs.lstat(absolutePath);
    } catch (error) {
      addReadError(context, absolutePath, error);
      continue;
    }
    if (stats.isSymbolicLink()) {
      continue;
    }
    if (stats.isDirectory()) {
      await collectMarkdownFiles(context, absolutePath, collected);
    } else if (stats.isFile() && isMarkdownFile(absolutePath)) {
      collected.push(absolutePath);
    }
  }
}

function finishResult(
  context: CheckContext,
  requestedPath: string
): LinkCheckResult {
  context.findings.sort(
    (left, right) =>
      compareText(left.source, right.source) ||
      left.line - right.line ||
      compareText(left.target, right.target) ||
      compareText(left.issue, right.issue)
  );
  const readErrors = [...context.readErrors.values()].sort(
    (left, right) => compareText(left.source, right.source) || compareText(left.code, right.code)
  );
  return {
    ok: true,
    error: null,
    base_path: context.baseDirectory,
    requested_path: requestedPath,
    files_scanned: context.filesScanned,
    links_checked: context.linksChecked,
    external_links_skipped: context.externalLinksSkipped,
    findings: context.findings,
    read_errors: readErrors
  };
}

function createContext(baseDirectory: string, fs: LocalFileSystem): CheckContext {
  return {
    baseDirectory,
    fs,
    contentCache: new Map<string, string | null>(),
    readErrors: new Map<string, ReadError>(),
    findings: [],
    filesScanned: 0,
    linksChecked: 0,
    externalLinksSkipped: 0
  };
}

export async function approveBaseDirectory(
  baseDirectory: string,
  fs: LocalFileSystem = nodeFileSystem
): Promise<string> {
  if (baseDirectory.trim().length === 0 || baseDirectory.includes("\0")) {
    throw new Error("--base-dir must contain a valid local directory path.");
  }
  const requested = path.resolve(baseDirectory);
  const stats = await fs.lstat(requested);
  if (!stats.isDirectory()) {
    throw new Error("--base-dir must point to a directory.");
  }
  return fs.realpath(requested);
}

export async function scanMarkdownLinks(
  baseDirectory: string,
  input: ScanMarkdownLinksInput,
  fs: LocalFileSystem = nodeFileSystem
): Promise<ScanMarkdownLinksResult> {
  const resolved = await resolveRequest(baseDirectory, input.path, "directory", fs);
  if (!("absolutePath" in resolved)) {
    return resolved;
  }
  const context = createContext(baseDirectory, fs);
  const files: string[] = [];
  await collectMarkdownFiles(context, resolved.absolutePath, files);
  files.sort(compareText);
  for (const file of files) {
    await inspectMarkdownFile(context, file);
  }
  return finishResult(context, resolved.displayPath);
}

export async function checkMarkdownFile(
  baseDirectory: string,
  input: CheckMarkdownFileInput,
  fs: LocalFileSystem = nodeFileSystem
): Promise<CheckMarkdownFileResult> {
  const resolved = await resolveRequest(baseDirectory, input.path, "file", fs);
  if (!("absolutePath" in resolved)) {
    return resolved;
  }
  const context = createContext(baseDirectory, fs);
  await inspectMarkdownFile(context, resolved.absolutePath);
  return finishResult(context, resolved.displayPath);
}
