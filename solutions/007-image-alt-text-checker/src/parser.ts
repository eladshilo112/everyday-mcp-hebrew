import { MAX_SNIPPET_CHARACTERS, type Finding } from "./schemas.js";

function decodeEntities(value: string): string {
  const named: Record<string, string> = { nbsp: " ", Tab: "\t", NewLine: "\n", quot: '"', apos: "'", amp: "&", lt: "<", gt: ">" };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole: string, entity: string) => {
    if (!entity.startsWith("#")) return named[entity] ?? whole;
    const hex = entity[1]?.toLowerCase() === "x";
    const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

export function classifyAlt(alt: string | undefined, markdown = false): Finding["issue_type"] | null {
  if (alt === undefined || (markdown && alt === "")) return "missing";
  const clean = decodeEntities(alt).trim();
  if (clean === "") return "empty";
  return /^(?:image|photo|picture|img)\d*$/i.test(clean) ? "generic" : null;
}

const blank = (text: string): string => text.replace(/[^\r\n]/g, " ");
// Preserve offsets and line numbers while excluding non-rendered examples.
function maskExamples(text: string, markdown: boolean): string {
  let masked = text.replace(/<!--[\s\S]*?(?:-->|$)/g, blank)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, blank);
  if (markdown) {
    let fence: { char: string; size: number } | undefined;
    masked = masked.split(/(?<=\n)/).map(line => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (marker?.[0] === fence.char && marker.length >= fence.size && line.slice(line.indexOf(marker) + marker.length).trim() === "") fence = undefined;
        return blank(line);
      }
      if (marker) { fence = { char: marker[0]!, size: marker.length }; return blank(line); }
      return line;
    }).join("").replace(/(`+)([^`]|(?!\1)`)*?\1/g, blank);
  }
  return masked;
}

// Quote-aware tag boundary; tolerate an unfinished tag without throwing.
function tagEnd(text: string, start: number): number {
  let quote = "";
  for (let i = start; i < text.length; i++) {
    const char = text[i]!;
    if (quote) { if (char === quote) quote = ""; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === ">") return i + 1;
    else if (char === "<") return i;
  }
  return text.length;
}

function htmlAlt(tag: string): string | undefined {
  const attributes = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)(?:"|$)|'([^']*)(?:'|$)|([^\s>]+)))?/g;
  for (const match of tag.slice(4).matchAll(attributes)) {
    if (match[1]?.toLowerCase() === "alt") return match[2] ?? match[3] ?? match[4] ?? "";
  }
  return undefined;
}

export function parseImages(text: string, file: string): { images: number; findings: Finding[] } {
  const markdown = /\.mdx?$/i.test(file);
  let masked = maskExamples(text, markdown);
  const found: { offset: number; end: number; alt: string | undefined; markdown: boolean }[] = [];
  const tags = /<img\b/gi;
  let tag: RegExpExecArray | null;
  while ((tag = tags.exec(masked)) !== null) {
    const end = tagEnd(masked, tag.index + 4);
    found.push({ offset: tag.index, end, alt: htmlAlt(masked.slice(tag.index, end)), markdown: false });
    tags.lastIndex = end;
  }
  // Do not interpret Markdown syntax embedded inside HTML attributes twice.
  for (const item of [...found].reverse()) masked = masked.slice(0, item.offset) + blank(masked.slice(item.offset, item.end)) + masked.slice(item.end);
  if (markdown) {
    const images = /!\[((?:\\.|[^\]\\])*)\]\(\s*(?:\\.|[^()\\]|\([^()]*\))*\)/g;
    for (const match of masked.matchAll(images)) {
      let backslashes = 0;
      for (let i = match.index - 1; i >= 0 && masked[i] === "\\"; i--) backslashes++;
      if (backslashes % 2) continue;
      found.push({ offset: match.index, end: match.index + match[0].length, alt: match[1]!.replace(/\\(.)/g, "$1"), markdown: true });
    }
  }
  found.sort((a, b) => a.offset - b.offset);
  const findings: Finding[] = [];
  let cursor = 0;
  let line = 1;
  for (const item of found) {
    for (; cursor < item.offset; cursor++) {
      if (text[cursor] === "\n" || (text[cursor] === "\r" && text[cursor + 1] !== "\n")) line++;
    }
    const issue = classifyAlt(item.alt, item.markdown);
    if (issue) findings.push({ file, line, snippet: text.slice(item.offset, Math.min(item.end, item.offset + MAX_SNIPPET_CHARACTERS)), issue_type: issue });
  }
  return { images: found.length, findings };
}
