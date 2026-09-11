import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { parseImages } from "./parser.js";
import { emptyCounts, inputSchema, MAX_FILE_BYTES, MAX_RETURNED_ITEMS, type Report, type Scan } from "./schemas.js";

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const relative = (root: string, file: string): string => path.relative(root, file).split(path.sep).join("/");
const within = (root: string, file: string): boolean => {
  const rel = path.relative(root, file);
  return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`));
};
function code(error: unknown): string {
  const value = (error as { code?: unknown })?.code;
  return typeof value === "string" && /^[A-Z_]+$/.test(value) ? value : "READ_FAILED";
}
function result(): Scan {
  return { ok: true, complete: true, files_scanned: 0, images_scanned: 0, total_findings: 0,
    by_issue: emptyCounts(), by_file: [], files_with_findings: 0, files_omitted: 0,
    errors: [], errors_omitted: 0, findings: [], findings_omitted: 0 };
}

export async function scanAltText(input: unknown): Promise<Scan> {
  const output = result();
  const addError = (file: string, error: string): void => {
    output.ok = false; output.complete = false;
    if (output.errors.length < MAX_RETURNED_ITEMS) output.errors.push({ file, code: error });
    else output.errors_omitted++;
  };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) { addError(".", "INVALID_INPUT"); return output; }
  const directory = parsed.data.directory;
  // Reject network/device paths before making any filesystem call.
  if (/^[\\/]{2}|^[a-z][a-z\d+.-]*:\/\//i.test(directory) || directory.includes("\0")) {
    addError(".", "NON_LOCAL_PATH"); return output;
  }
  if (!path.isAbsolute(directory) || (process.platform === "win32" && !/^[a-z]:[\\/]/i.test(directory))) {
    addError(".", "ABSOLUTE_PATH_REQUIRED"); return output;
  }
  const selected = path.resolve(directory);
  let root: string;
  try {
    // Reject symlinks/junctions in the selected root and its ancestry.
    let component = path.parse(selected).root;
    for (const part of selected.slice(component.length).split(path.sep).filter(Boolean)) {
      component = path.join(component, part);
      if ((await lstat(component)).isSymbolicLink()) { addError(".", "SYMLINK_ROOT"); return output; }
    }
    if (!(await lstat(selected)).isDirectory()) { addError(".", "NOT_DIRECTORY"); return output; }
    root = await realpath(selected);
  } catch (error) { addError(".", code(error)); return output; }

  async function readDocument(file: string): Promise<void> {
    const display = relative(root, file);
    try {
      if (!within(root, await realpath(file))) { addError(display, "OUTSIDE_ROOT"); return; }
      const info = await lstat(file);
      if (info.isSymbolicLink() || !info.isFile()) return;
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const current = await handle.stat();
        if (!current.isFile() || current.ino !== info.ino || current.dev !== info.dev) { addError(display, "FILE_CHANGED"); return; }
        if (current.size > MAX_FILE_BYTES) { addError(display, "FILE_TOO_LARGE"); return; }
        // Bounded read even if a file grows after stat; never read a FIFO/device.
        const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
        let size = 0;
        while (size < buffer.length) {
          const read = await handle.read(buffer, size, buffer.length - size, size);
          if (read.bytesRead === 0) break;
          size += read.bytesRead;
        }
        if (size > MAX_FILE_BYTES) { addError(display, "FILE_TOO_LARGE"); return; }
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)); }
        catch { addError(display, "INVALID_UTF8"); return; }
        const images = parseImages(text, display);
        output.files_scanned++; output.images_scanned += images.images;
        if (images.findings.length) {
          const counts = emptyCounts();
          for (const finding of images.findings) {
            counts[finding.issue_type]++; output.by_issue[finding.issue_type]++; output.total_findings++;
            if (output.findings.length < MAX_RETURNED_ITEMS) output.findings.push(finding);
          }
          output.files_with_findings++;
          if (output.by_file.length < MAX_RETURNED_ITEMS) output.by_file.push({ file: display, total: images.findings.length, counts });
        }
      } finally { await handle.close(); }
    } catch (error) { addError(display, code(error)); }
  }

  // An iterative lexical frontier avoids recursion depth overflow and preserves
  // global relative-path order (including punctuation next to directory names).
  const pending = [root];
  while (pending.length) {
    pending.sort((a, b) => compare(relative(root, b), relative(root, a)));
    const entry = pending.pop()!;
    try {
      const info = await lstat(entry);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        if (!within(root, await realpath(entry))) { addError(relative(root, entry), "OUTSIDE_ROOT"); continue; }
        for (const child of await readdir(entry, { withFileTypes: true })) {
          if (child.name.startsWith(".") || child.name.toLowerCase() === "node_modules" || child.isSymbolicLink()) continue;
          if (child.isDirectory() || (child.isFile() && /\.(?:md|mdx|html)$/i.test(child.name))) pending.push(path.join(entry, child.name));
        }
      } else if (info.isFile()) await readDocument(entry);
    } catch (error) { addError(relative(root, entry) || ".", code(error)); }
  }
  output.findings_omitted = output.total_findings - output.findings.length;
  output.files_omitted = output.files_with_findings - output.by_file.length;
  return output;
}

export async function getAltTextReport(input: unknown): Promise<Report> {
  const { findings: _findings, findings_omitted: _omitted, ...report } = await scanAltText(input);
  return report;
}
