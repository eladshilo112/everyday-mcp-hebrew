import { analyze, compareFindings, type Finding } from "./headings.js";
import { MAX_RETURNED_ITEMS, comparePaths, discover, display, errorCode, readMarkdown, resolveRelative } from "./files.js";
import type { z } from "zod";
import type { listInput, scanInput } from "./schemas.js";

type ListInput = z.infer<typeof listInput>;
type ScanInput = z.infer<typeof scanInput>;
type Note = { path: string; code: string };

export async function listFiles(root: string, input: ListInput) {
  try {
    const found = await discover(root, input.directory, input.recursive);
    return { ok: found.errors.length === 0, files: found.files, truncated: found.truncated, errors: found.errors };
  } catch (error) { return { ok: false, files: [] as string[], truncated: false, errors: [{ path: input.directory, code: errorCode(error) }] }; }
}

export async function scan(root: string, input: ScanInput) {
  const files: { file: string; h1_count: number; h1_lines: number[]; finding_count: number }[] = [];
  const findings: Finding[] = [], skipped: Note[] = [], errors: Note[] = [];
  let selected: string[] = [], truncated = false;
  if ((input.paths === undefined) === (input.directory === undefined)) {
    return { ok: false, files_scanned: 0, files, findings, truncated, skipped, errors: [{ path: ".", code: "INVALID_INPUT" }] };
  }
  if (input.directory !== undefined) {
    try {
      const found = await discover(root, input.directory, input.recursive);
      selected = found.files; truncated = found.truncated; errors.push(...found.errors);
    } catch (error) { errors.push({ path: input.directory, code: errorCode(error) }); }
  } else {
    selected = [...new Set(input.paths ?? [])].sort(comparePaths);
    if (selected.length > MAX_RETURNED_ITEMS) { selected = selected.slice(0, MAX_RETURNED_ITEMS); truncated = true; }
  }
  for (const name of selected) {
    let file: string;
    try { file = display(root, resolveRelative(root, name)); }
    catch (error) { if (errors.length < MAX_RETURNED_ITEMS) errors.push({ path: name, code: errorCode(error) }); continue; }
    try {
      const result = analyze(file, await readMarkdown(root, name));
      if (result.h1_lines.length > MAX_RETURNED_ITEMS) truncated = true;
      files.push({ file, h1_count: result.h1_lines.length, h1_lines: result.h1_lines.slice(0, MAX_RETURNED_ITEMS), finding_count: result.findings.length });
      for (const finding of result.findings) {
        if (findings.length < MAX_RETURNED_ITEMS) findings.push(finding);
        else truncated = true;
      }
    } catch (error) {
      const note = { path: file, code: errorCode(error) };
      if (["UNSUPPORTED_ENCODING_OR_BINARY", "FILE_TOO_LARGE"].includes(note.code)) skipped.push(note);
      else errors.push(note);
    }
  }
  files.sort((a, b) => comparePaths(a.file, b.file));
  findings.sort(compareFindings);
  skipped.sort((a, b) => comparePaths(a.path, b.path));
  errors.sort((a, b) => comparePaths(a.path, b.path));
  return { ok: errors.length === 0 && skipped.length === 0, files_scanned: files.length, files, findings, truncated, skipped: skipped.slice(0, MAX_RETURNED_ITEMS), errors: errors.slice(0, MAX_RETURNED_ITEMS) };
}
