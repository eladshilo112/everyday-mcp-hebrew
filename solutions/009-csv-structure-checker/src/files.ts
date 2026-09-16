import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LIMITS } from "./types.js";

export class FileError extends Error {
  constructor(public readonly code: string) { super(code); }
}
const execute = promisify(execFile);
const samePath = (a: string, b: string): boolean => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

// Node exposes symlinks/junctions, but not every Windows reparse tag. Query the
// native FileAttributes bit too. The script is constant; input is an env value,
// never shell code. No profiles, content execution, writes or network commands.
async function rejectWindowsReparse(target: string): Promise<void> {
  if (process.platform !== "win32") return;
  const script = "$ErrorActionPreference='Stop'; $p=$env:CSV_STRUCTURE_CHECK_PATH; if (([System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($p))).DriveType -eq [System.IO.DriveType]::Network) { exit 3 }; while ($p) { if (([System.IO.File]::GetAttributes($p) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { exit 2 }; $p=[System.IO.Path]::GetDirectoryName($p) }; [Console]::Write('OK')";
  try {
    const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const { stdout } = await execute(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, CSV_STRUCTURE_CHECK_PATH: target }, windowsHide: true, timeout: 10000, maxBuffer: 4096
    });
    if (stdout !== "OK") throw new FileError("PATH_REJECTED");
  } catch { throw new FileError("PATH_REJECTED"); }
}

async function inspect(target: string): Promise<Awaited<ReturnType<typeof lstat>>> {
  const volume = path.parse(target).root;
  let cursor = volume;
  for (const component of target.slice(volume.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) throw new FileError("PATH_REJECTED");
    if (cursor !== target && !stat.isDirectory()) throw new FileError("PATH_REJECTED");
  }
  await rejectWindowsReparse(target);
  if (!samePath(await realpath(target), target)) throw new FileError("PATH_REJECTED");
  return lstat(target);
}

export async function validateRoot(root: string): Promise<string> {
  if (!path.isAbsolute(root) || root.startsWith("\\\\") || root.startsWith("//")) throw new FileError("INVALID_ROOT");
  const resolved = path.resolve(root);
  if (!(await inspect(resolved)).isDirectory()) throw new FileError("INVALID_ROOT");
  return resolved;
}

export function resolveInput(root: string, relative: string): string {
  // Reject Windows forms even on POSIX, including ADS, device names and aliases.
  if (!relative || relative.length > 4096 || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || /[:\x00-\x1f]/u.test(relative)) throw new FileError("PATH_REJECTED");
  const parts = relative.split(/[\\/]/u);
  if (parts.some(p => !p || p === "." || p === ".." || /[. ]$/u.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(p))) throw new FileError("PATH_REJECTED");
  const target = path.resolve(root, ...parts);
  const distance = path.relative(root, target);
  if (!distance || distance.startsWith(`..${path.sep}`) || distance === ".." || path.isAbsolute(distance)) throw new FileError("PATH_REJECTED");
  return target;
}

export interface ByteReader { read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }> }
export async function readBounded(reader: ByteReader): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    // At the boundary, probe exactly one more byte. Never trust stat.size.
    const buffer = Buffer.alloc(Math.min(65536, LIMITS.fileBytes + 1 - total));
    const { bytesRead } = await reader.read(buffer, 0, buffer.length, total);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > LIMITS.fileBytes) throw new FileError("FILE_BYTES_LIMIT");
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

export async function readLocal(root: string, relative: string): Promise<string> {
  const target = resolveInput(root, relative);
  const before = await inspect(target);
  if (!before.isFile()) throw new FileError("NOT_REGULAR_FILE");
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await handle.stat();
    const checked = await inspect(target);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || checked.dev !== opened.dev || checked.ino !== opened.ino) throw new FileError("FILE_CHANGED");
    const bytes = await readBounded(handle);
    const after = await handle.stat();
    const final = await inspect(target);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || final.dev !== opened.dev || final.ino !== opened.ino) throw new FileError("FILE_CHANGED");
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.includes("\0")) throw new Error("Unsupported NUL encoding");
      return text;
    } catch { throw new FileError("UNSUPPORTED_ENCODING"); }
  } finally { await handle.close(); }
}
