export interface Heading { line: number; level: number; text: string }
export interface Finding { file: string; line: number; code: "SKIPPED_LEVEL" | "MISSING_H1" | "MULTIPLE_H1" | "EMPTY_HEADING" | "DUPLICATE_HEADING"; level: number | null; related_lines: number[]; text?: string }

function plainText(raw: string): string {
  const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
  return raw.replace(/!?(?:\[([^\]]+)\])\([^)]*\)/gu, "$1")
    .replace(/<[^>]*>/gu, "")
    .replace(/&(?:amp|lt|gt|quot|apos);/gu, entity => entities[entity] ?? entity)
    .replace(/[\\`*_~]/gu, "").replace(/\s+/gu, " ").trim();
}

export function parseHeadings(source: string): Heading[] {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  const headings: Heading[] = [];
  let fence: { marker: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/u.exec(line);
    const run = opening?.[2];
    if (fence) {
      if (run && run[0] === fence.marker && run.length >= fence.length && /^\s*$/u.test(opening?.[3] ?? "")) fence = null;
      continue;
    }
    if (run) { fence = { marker: run[0] ?? "`", length: run.length }; continue; }
    if (/^( {4,}|\t)/u.test(line)) continue;
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/u.exec(line);
    if (atx) {
      const raw = (atx[2] ?? "").replace(/[ \t]+#+[ \t]*$/u, "");
      const content = /^#+[ \t]*$/u.test(raw) ? "" : raw;
      headings.push({ line: index + 1, level: atx[1]?.length ?? 1, text: plainText(content) });
      continue;
    }
    if (/^ {0,3}(?:=+|-+)[ \t]*$/u.test(line) && index > 0) {
      const previous = lines[index - 1] ?? "";
      if (previous.trim() && !/^\s*(?:#{1,6}\s|>|[-*+]\s|\d+\.\s)/u.test(previous) && !/^( {4,}|\t)/u.test(previous)) {
        headings.push({ line: index, level: line.trimStart().startsWith("=") ? 1 : 2, text: plainText(previous) });
      }
    }
  }
  return headings;
}

const codeOrder: Record<Finding["code"], number> = { MISSING_H1: 0, MULTIPLE_H1: 1, EMPTY_HEADING: 2, SKIPPED_LEVEL: 3, DUPLICATE_HEADING: 4 };
export function compareFindings(a: Finding, b: Finding): number {
  return a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || codeOrder[a.code] - codeOrder[b.code];
}
export function analyze(file: string, source: string): { h1_lines: number[]; findings: Finding[] } {
  const headings = parseHeadings(source);
  const h1_lines = headings.filter(heading => heading.level === 1).map(heading => heading.line);
  const findings: Finding[] = [];
  if (h1_lines.length === 0) findings.push({ file, line: 1, code: "MISSING_H1", level: 1, related_lines: [] });
  if (h1_lines.length > 1) findings.push({ file, line: h1_lines[1] ?? 1, code: "MULTIPLE_H1", level: 1, related_lines: h1_lines.slice(0, 200) });
  const seen = new Map<string, number>();
  let previous: Heading | undefined;
  for (const heading of headings) {
    if (!heading.text) findings.push({ file, line: heading.line, code: "EMPTY_HEADING", level: heading.level, related_lines: [] });
    if (previous && heading.level > previous.level + 1) findings.push({ file, line: heading.line, code: "SKIPPED_LEVEL", level: heading.level, related_lines: [previous.line] });
    if (heading.text) {
      const key = `${heading.level}\0${heading.text.normalize("NFC")}`;
      const first = seen.get(key);
      if (first !== undefined) findings.push({ file, line: heading.line, code: "DUPLICATE_HEADING", level: heading.level, related_lines: [first], text: heading.text.slice(0, 160) });
      else seen.set(key, heading.line);
    }
    previous = heading;
  }
  findings.sort(compareFindings);
  return { h1_lines, findings };
}
