import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export const MAX_RETURNED_ITEMS = 200;
export const MAX_FILE_BYTES = 2_000_000;
const MAX_VISITED_ENTRIES = 20_000;
const MAX_VISITED_DIRECTORIES = 2_000;
export class LocalError extends Error { constructor(public readonly code: string) { super(code); } }
export const comparePaths = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const same = (a: string, b: string): boolean => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

export async function validateRoot(input: string): Promise<string> {
  if (!path.isAbsolute(input) || input.startsWith("\\\\") || input.startsWith("//")) throw new LocalError("INVALID_ROOT");
  const root = path.resolve(input);
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !same(await realpath(root), root)) throw new LocalError("INVALID_ROOT");
    return root;
  } catch { throw new LocalError("INVALID_ROOT"); }
}

export function resolveRelative(root: string, relative: string): string {
  if (relative === ".") return root;
  if (!relative || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || /[:\x00-\x1f]/u.test(relative)) throw new LocalError("PATH_REJECTED");
  const parts = relative.split(/[\\/]/u);
  if (parts.some(part => !part || part === "." || part === ".." || /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) throw new LocalError("PATH_REJECTED");
  const target = path.resolve(root, ...parts);
  const distance = path.relative(root, target);
  if (!distance || distance === ".." || distance.startsWith(`..${path.sep}`) || path.isAbsolute(distance)) throw new LocalError("PATH_REJECTED");
  return target;
}

export function display(root: string, target: string): string { return path.relative(root, target).split(path.sep).join("/") || "."; }

export async function inspect(root: string, target: string): Promise<Awaited<ReturnType<typeof lstat>>> {
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new LocalError("PATH_REJECTED");
  let cursor = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink() || !same(await realpath(cursor), cursor)) throw new LocalError("PATH_REJECTED");
    if (cursor !== target && !stat.isDirectory()) throw new LocalError("PATH_REJECTED");
  }
  return lstat(target);
}

export function markdown(target: string): boolean { return /\.mdx?$/iu.test(target); }
export function errorCode(error: unknown): string {
  if (error instanceof LocalError) return error.code;
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "ENOENT") return "NOT_FOUND";
    if (error.code === "EACCES" || error.code === "EPERM") return "ACCESS_DENIED";
  }
  return "READ_ERROR";
}

export async function readMarkdown(root: string, relative: string): Promise<string> {
  const target = resolveRelative(root, relative);
  if (!markdown(target)) throw new LocalError("NOT_MARKDOWN");
  const before = await inspect(root, target);
  if (!before.isFile()) throw new LocalError("NOT_REGULAR_FILE");
  if (before.size > MAX_FILE_BYTES) throw new LocalError("FILE_TOO_LARGE");
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await handle.stat();
    const checked = await inspect(root, target);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || checked.dev !== opened.dev || checked.ino !== opened.ino) throw new LocalError("FILE_CHANGED");
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65_536, MAX_FILE_BYTES + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_FILE_BYTES) throw new LocalError("FILE_TOO_LARGE");
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    const final = await inspect(root, target);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || final.dev !== opened.dev || final.ino !== opened.ino) throw new LocalError("FILE_CHANGED");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total)); }
    catch { throw new LocalError("UNSUPPORTED_ENCODING_OR_BINARY"); }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text)) throw new LocalError("UNSUPPORTED_ENCODING_OR_BINARY");
    return text;
  } finally { await handle.close(); }
}

export interface Discovery { files: string[]; truncated: boolean; errors: { path: string; code: string }[] }
export async function discover(root: string, directory: string, recursive: boolean): Promise<Discovery> {
  const target = resolveRelative(root, directory);
  if (!(await inspect(root, target)).isDirectory()) throw new LocalError("NOT_DIRECTORY");
  const files: string[] = [], errors: Discovery["errors"] = [];
  const pending = [target];
  let visitedEntries = 0, visitedDirectories = 0, truncated = false;
  while (pending.length) {
    const current = pending.shift();
    if (!current) break;
    if (++visitedDirectories > MAX_VISITED_DIRECTORIES) { truncated = true; break; }
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); }
    catch (error) { if (errors.length < MAX_RETURNED_ITEMS) errors.push({ path: display(root, current), code: errorCode(error) }); continue; }
    entries.sort((a, b) => comparePaths(a.name, b.name));
    for (const entry of entries) {
      if (++visitedEntries > MAX_VISITED_ENTRIES) { truncated = true; break; }
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const item = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (recursive) {
          try { if ((await inspect(root, item)).isDirectory()) pending.push(item); }
          catch (error) { if (errors.length < MAX_RETURNED_ITEMS) errors.push({ path: display(root, item), code: errorCode(error) }); }
        }
        continue;
      }
      if (entry.isFile() && markdown(item)) {
        if (files.length === MAX_RETURNED_ITEMS) { truncated = true; break; }
        files.push(display(root, item));
      }
    }
    if (truncated) break;
  }
  files.sort(comparePaths);
  errors.sort((a, b) => comparePaths(a.path, b.path));
  return { files, truncated, errors };
}
