import type { Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import {
  LONG_SENTENCE_WORDS,
  MAX_EXCERPT_CHARACTERS,
  MAX_FILE_PATH_CHARACTERS,
  MAX_INPUT_CHARACTERS,
  MAX_RETURNED_ITEMS,
  type CheckClarityResult,
  type ClarityIssue,
  type ClarityLabel,
  type ComplexSentence,
  type IssueType,
  type ListIssuesResult,
  type SourceKind,
  type TextSourceInput,
  type ToolError
} from "./schemas.js";

const READ_CHUNK_BYTES = 64 * 1024;
const WORD_PATTERN =
  /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’"״׳־-][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu;
const SENTENCE_END_PATTERN = /[.!?…]/u;

const HEBREW_PASSIVE_WITH_AGENT =
  /(?<![\p{L}\p{N}_])[\p{L}]+\s+על\s+ידי(?![\p{L}\p{N}_])/giu;
const HEBREW_PASSIVE_VERBS =
  /(?<![\p{L}\p{N}_])(?:נכתב|נכתבה|נכתבו|נשלח|נשלחה|נשלחו|בוצע|בוצעה|בוצעו|הוכן|הוכנה|הוכנו|אושר|אושרה|אושרו|נקבע|נקבעה|נקבעו|נבדק|נבדקה|נבדקו|נוצר|נוצרה|נוצרו|טופל|טופלה|טופלו)(?![\p{L}\p{N}_])/gu;
const ENGLISH_PASSIVE =
  /\b(?:am|is|are|was|were|be|been|being)\s+(?:(?:very|carefully|quickly|recently|already|also)\s+)?(?:[a-z]+(?:ed|en)|built|made|given|sent|done|known|shown|taken|held|found|written)\b/giu;

export const COMPLEX_TERMS = [
  "אופטימיזציה",
  "אימפלמנטציה",
  "אינטרדיסציפלינרי",
  "קונסולידציה",
  "מתודולוגיה",
  "סינרגיה",
  "סקיילביליות",
  "פרדיגמה",
  "facilitate",
  "leverage",
  "methodology",
  "operationalize",
  "optimization",
  "paradigm",
  "scalability",
  "synergy",
  "utilize",
  "value add"
] as const;

interface BoundedReadResult {
  text: string;
  tooLarge: boolean;
}

export interface LocalFileSystem {
  lstat(filePath: string): Promise<Stats>;
  realpath(filePath: string): Promise<string>;
  readTextFile(filePath: string, maxCharacters: number): Promise<BoundedReadResult>;
}

class InvalidUtf8Error extends Error {
  override readonly name = "InvalidUtf8Error";
}

async function readUtf8FileBounded(
  filePath: string,
  maxCharacters: number
): Promise<BoundedReadResult> {
  const handle = await open(filePath, "r");
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    const chunks: string[] = [];
    let characterCount = 0;
    let atStart = true;

    const removeLeadingByteOrderMark = (decoded: string): string => {
      if (!atStart || decoded.length === 0) {
        return decoded;
      }
      atStart = false;
      return stripByteOrderMark(decoded);
    };

    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      let decoded: string;
      try {
        decoded = removeLeadingByteOrderMark(
          decoder.decode(buffer.subarray(0, bytesRead), { stream: true })
        );
      } catch (error) {
        throw new InvalidUtf8Error("The file is not valid UTF-8.", { cause: error });
      }
      chunks.push(decoded);
      characterCount += Array.from(decoded).length;
      if (characterCount > maxCharacters) {
        return { text: "", tooLarge: true };
      }
    }

    let finalChunk: string;
    try {
      finalChunk = removeLeadingByteOrderMark(decoder.decode());
    } catch (error) {
      throw new InvalidUtf8Error("The file is not valid UTF-8.", { cause: error });
    }
    chunks.push(finalChunk);
    characterCount += Array.from(finalChunk).length;
    if (characterCount > maxCharacters) {
      return { text: "", tooLarge: true };
    }
    return { text: chunks.join(""), tooLarge: false };
  } finally {
    await handle.close();
  }
}

export const nodeFileSystem: LocalFileSystem = {
  lstat: async (filePath) => lstat(filePath),
  realpath: async (filePath) => realpath(filePath),
  readTextFile: readUtf8FileBounded
};

interface LoadedSource {
  ok: true;
  text: string;
  sourceKind: SourceKind;
  sourcePath: string | null;
}

interface SourceFailure {
  ok: false;
  error: ToolError;
  sourceKind: SourceKind | null;
  sourcePath: string | null;
}

type SourceResult = LoadedSource | SourceFailure;

interface Sentence {
  line: number;
  text: string;
  wordCount: number;
}

interface LocatedMatch {
  index: number;
  value: string;
}

export interface ClarityAnalysis {
  character_count: number;
  word_count: number;
  sentence_count: number;
  average_sentence_length: number;
  clarity_score: number;
  clarity_label: ClarityLabel;
  long_sentence_count: number;
  passive_count: number;
  complex_term_count: number;
  issue_count: number;
  complex_sentence_count: number;
  complex_sentences_returned: number;
  complex_sentences_omitted: number;
  complex_sentences: ComplexSentence[];
  issues_returned: number;
  issues_omitted: number;
  issues: ClarityIssue[];
}

function countCharacters(value: string): number {
  return Array.from(value).length;
}

function stripByteOrderMark(value: string): string {
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

function countWords(value: string): number {
  return Array.from(value.matchAll(WORD_PATTERN)).length;
}

function excerpt(value: string): string {
  const trimmed = value.trim();
  const characters = Array.from(trimmed);
  if (characters.length <= MAX_EXCERPT_CHARACTERS) {
    return trimmed;
  }
  return `${characters.slice(0, MAX_EXCERPT_CHARACTERS - 1).join("")}…`;
}

function splitSentences(value: string): Sentence[] {
  const normalized = value.replace(/\r\n?/gu, "\n");
  const sentences: Sentence[] = [];
  let buffer = "";
  let line = 1;
  let startLine = 1;
  let started = false;

  const flush = (): void => {
    const text = buffer.trim();
    const wordCount = countWords(text);
    if (wordCount > 0) {
      sentences.push({ line: startLine, text, wordCount });
    }
    buffer = "";
    started = false;
  };

  for (const character of normalized) {
    if (character === "\n") {
      flush();
      line += 1;
      continue;
    }
    if (!started && !/\s/u.test(character)) {
      started = true;
      startLine = line;
    }
    if (started) {
      buffer += character;
    }
    if (SENTENCE_END_PATTERN.test(character)) {
      flush();
    }
  }
  flush();
  return sentences;
}

function regexMatches(value: string, pattern: RegExp): LocatedMatch[] {
  const matches: LocatedMatch[] = [];
  for (const match of value.matchAll(pattern)) {
    if (match.index !== undefined && match[0] !== undefined) {
      matches.push({ index: match.index, value: match[0] });
    }
  }
  return matches;
}

function passiveMatches(value: string): LocatedMatch[] {
  const candidates = [
    ...regexMatches(value, HEBREW_PASSIVE_WITH_AGENT),
    ...regexMatches(value, HEBREW_PASSIVE_VERBS),
    ...regexMatches(value, ENGLISH_PASSIVE)
  ].sort((left, right) =>
    left.index - right.index || right.value.length - left.value.length ||
    (left.value < right.value ? -1 : left.value > right.value ? 1 : 0)
  );
  const selected: LocatedMatch[] = [];
  let selectedEnd = -1;
  for (const candidate of candidates) {
    if (candidate.index >= selectedEnd) {
      selected.push(candidate);
      selectedEnd = candidate.index + candidate.value.length;
    }
  }
  return selected;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const COMPLEX_TERM_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:${COMPLEX_TERMS.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_])`,
  "giu"
);

function complexTermMatches(value: string): LocatedMatch[] {
  const matches = regexMatches(value, COMPLEX_TERM_PATTERN);
  return matches.sort((left, right) =>
    left.index - right.index ||
    (left.value.toLowerCase() < right.value.toLowerCase()
      ? -1
      : left.value.toLowerCase() > right.value.toLowerCase()
        ? 1
        : 0)
  );
}

function clarityLabel(score: number, wordCount: number): ClarityLabel {
  if (wordCount === 0) {
    return "ללא טקסט";
  }
  if (score >= 80) {
    return "ברור";
  }
  if (score >= 60) {
    return "דורש שיפור";
  }
  return "קשה לקריאה";
}

export function analyzeText(rawText: string): ClarityAnalysis {
  const text = stripByteOrderMark(rawText);
  const sentences = splitSentences(text);
  const wordCount = sentences.reduce((sum, sentence) => sum + sentence.wordCount, 0);
  const issues: ClarityIssue[] = [];
  const complexSentences: ComplexSentence[] = [];
  let longSentenceCount = 0;
  let passiveCount = 0;
  let complexTermCount = 0;
  let complexSentenceCount = 0;

  for (const sentence of sentences) {
    const isLong = sentence.wordCount > LONG_SENTENCE_WORDS;
    const passives = passiveMatches(sentence.text);
    const complexTerms = complexTermMatches(sentence.text);
    if (isLong) {
      longSentenceCount += 1;
    }
    passiveCount += passives.length;
    complexTermCount += complexTerms.length;
    if (!isLong && passives.length === 0 && complexTerms.length === 0) {
      continue;
    }

    complexSentenceCount += 1;
    let cachedExcerpt: string | null = null;
    const sentenceExcerpt = (): string => {
      cachedExcerpt ??= excerpt(sentence.text);
      return cachedExcerpt;
    };

    if (complexSentences.length < MAX_RETURNED_ITEMS) {
      const issueTypes: IssueType[] = [];
      if (isLong) {
        issueTypes.push("long_sentence");
      }
      if (passives.length > 0) {
        issueTypes.push("passive_voice");
      }
      if (complexTerms.length > 0) {
        issueTypes.push("complex_term");
      }
      complexSentences.push({
        line: sentence.line,
        text: sentenceExcerpt(),
        word_count: sentence.wordCount,
        issue_types: issueTypes
      });
    }

    if (isLong && issues.length < MAX_RETURNED_ITEMS) {
      issues.push({
        line: sentence.line,
        type: "long_sentence",
        type_he: "משפט ארוך",
        sentence: sentenceExcerpt(),
        word_count: sentence.wordCount,
        match: null,
        message_he: `המשפט ארוך מדי: ${sentence.wordCount} מילים, והסף הוא ${LONG_SENTENCE_WORDS}.`
      });
    }

    let passiveIndex = 0;
    let complexTermIndex = 0;
    while (
      issues.length < MAX_RETURNED_ITEMS &&
      (passiveIndex < passives.length || complexTermIndex < complexTerms.length)
    ) {
      const passive = passives[passiveIndex];
      const complexTerm = complexTerms[complexTermIndex];
      const takePassive =
        passive !== undefined &&
        (complexTerm === undefined || passive.index <= complexTerm.index);
      if (takePassive && passive !== undefined) {
        issues.push({
          line: sentence.line,
          type: "passive_voice",
          type_he: "ניסוח פסיבי",
          sentence: sentenceExcerpt(),
          word_count: sentence.wordCount,
          match: passive.value,
          message_he: `נמצא ניסוח פסיבי אפשרי: "${passive.value}".`
        });
        passiveIndex += 1;
      } else if (complexTerm !== undefined) {
        issues.push({
          line: sentence.line,
          type: "complex_term",
          type_he: "מונח מסובך",
          sentence: sentenceExcerpt(),
          word_count: sentence.wordCount,
          match: complexTerm.value,
          message_he: `נמצא מונח מסובך אפשרי: "${complexTerm.value}".`
        });
        complexTermIndex += 1;
      }
    }
  }

  const averageSentenceLength =
    sentences.length === 0 ? 0 : Math.round((wordCount / sentences.length) * 10) / 10;
  const issueCount = longSentenceCount + passiveCount + complexTermCount;
  const averageLengthPenalty = Math.min(30, Math.max(0, Math.round(averageSentenceLength - 25)));
  const score =
    wordCount === 0
      ? 0
      : Math.max(
          0,
          100 -
            longSentenceCount * 12 -
            passiveCount * 8 -
            complexTermCount * 4 -
            averageLengthPenalty
        );

  return {
    character_count: countCharacters(text),
    word_count: wordCount,
    sentence_count: sentences.length,
    average_sentence_length: averageSentenceLength,
    clarity_score: score,
    clarity_label: clarityLabel(score, wordCount),
    long_sentence_count: longSentenceCount,
    passive_count: passiveCount,
    complex_term_count: complexTermCount,
    issue_count: issueCount,
    complex_sentence_count: complexSentenceCount,
    complex_sentences_returned: complexSentences.length,
    complex_sentences_omitted: complexSentenceCount - complexSentences.length,
    complex_sentences: complexSentences,
    issues_returned: issues.length,
    issues_omitted: issueCount - issues.length,
    issues
  };
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

function isNetworkPath(value: string): boolean {
  const normalized = value.replace(/\//gu, "\\");
  return (
    normalized.startsWith("\\\\") ||
    /^\\\\\?\\UNC\\/iu.test(normalized) ||
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(value)
  );
}

async function loadSource(input: TextSourceInput, fs: LocalFileSystem): Promise<SourceResult> {
  const hasText = input.text !== undefined;
  const hasFile = input.file_path !== undefined;
  if (hasText === hasFile) {
    return {
      ok: false,
      error: toolError("invalid_input", "Supply exactly one of text or file_path.", null),
      sourceKind: null,
      sourcePath: null
    };
  }

  if (input.text !== undefined) {
    const text = stripByteOrderMark(input.text);
    if (countCharacters(text) > MAX_INPUT_CHARACTERS) {
      return {
        ok: false,
        error: toolError(
          "input_too_large",
          `Text exceeds the ${MAX_INPUT_CHARACTERS}-character limit.`,
          null
        ),
        sourceKind: "text",
        sourcePath: null
      };
    }
    return { ok: true, text, sourceKind: "text", sourcePath: null };
  }

  const requestedPath = input.file_path ?? "";
  if (requestedPath.trim().length === 0 || requestedPath.includes("\0")) {
    return {
      ok: false,
      error: toolError("invalid_path", "The local file path is empty or invalid.", requestedPath),
      sourceKind: "file",
      sourcePath: requestedPath
    };
  }
  if (countCharacters(requestedPath) > MAX_FILE_PATH_CHARACTERS) {
    return {
      ok: false,
      error: toolError(
        "invalid_path",
        `The local file path exceeds the ${MAX_FILE_PATH_CHARACTERS}-character limit.`,
        null
      ),
      sourceKind: "file",
      sourcePath: null
    };
  }
  if (isNetworkPath(requestedPath)) {
    return {
      ok: false,
      error: toolError(
        "network_path_not_allowed",
        "Network paths and URL-like paths are not allowed.",
        requestedPath
      ),
      sourceKind: "file",
      sourcePath: requestedPath
    };
  }

  const lexicalPath = path.resolve(requestedPath);
  let stats: Stats;
  try {
    stats = await fs.lstat(lexicalPath);
  } catch (error) {
    const code = errorCode(error);
    const mappedCode = code === "ENOENT" ? "not_found" : code === "EACCES" || code === "EPERM"
      ? "permission_denied"
      : "read_failed";
    const message = mappedCode === "not_found"
      ? "The requested file does not exist."
      : mappedCode === "permission_denied"
        ? "The requested file cannot be read with the current permissions."
        : "The requested file could not be inspected.";
    return {
      ok: false,
      error: toolError(mappedCode, message, lexicalPath),
      sourceKind: "file",
      sourcePath: lexicalPath
    };
  }

  if (stats.isSymbolicLink()) {
    return {
      ok: false,
      error: toolError(
        "symlink_not_allowed",
        "A symbolic link cannot be used as the input file.",
        lexicalPath
      ),
      sourceKind: "file",
      sourcePath: lexicalPath
    };
  }
  if (!stats.isFile()) {
    return {
      ok: false,
      error: toolError("not_file", "The requested path is not a regular file.", lexicalPath),
      sourceKind: "file",
      sourcePath: lexicalPath
    };
  }

  let canonicalPath: string;
  try {
    canonicalPath = await fs.realpath(lexicalPath);
  } catch (error) {
    const code = errorCode(error);
    const mappedCode = code === "EACCES" || code === "EPERM" ? "permission_denied" : "read_failed";
    return {
      ok: false,
      error: toolError(mappedCode, "The requested file path could not be resolved.", lexicalPath),
      sourceKind: "file",
      sourcePath: lexicalPath
    };
  }
  if (isNetworkPath(canonicalPath)) {
    return {
      ok: false,
      error: toolError(
        "network_path_not_allowed",
        "The resolved path is a network path and is not allowed.",
        canonicalPath
      ),
      sourceKind: "file",
      sourcePath: canonicalPath
    };
  }

  try {
    const loaded = await fs.readTextFile(canonicalPath, MAX_INPUT_CHARACTERS);
    if (loaded.tooLarge) {
      return {
        ok: false,
        error: toolError(
          "input_too_large",
          `File text exceeds the ${MAX_INPUT_CHARACTERS}-character limit.`,
          canonicalPath
        ),
        sourceKind: "file",
        sourcePath: canonicalPath
      };
    }
    return {
      ok: true,
      text: stripByteOrderMark(loaded.text),
      sourceKind: "file",
      sourcePath: canonicalPath
    };
  } catch (error) {
    const code = errorCode(error);
    const mappedCode = error instanceof InvalidUtf8Error
      ? "invalid_encoding"
      : code === "EACCES" || code === "EPERM"
        ? "permission_denied"
        : code === "ENOENT"
          ? "not_found"
          : "read_failed";
    const message = mappedCode === "invalid_encoding"
      ? "The requested file is not valid UTF-8."
      : mappedCode === "permission_denied"
        ? "The requested file cannot be read with the current permissions."
        : mappedCode === "not_found"
          ? "The requested file no longer exists."
          : "The requested file could not be read.";
    return {
      ok: false,
      error: toolError(mappedCode, message, canonicalPath),
      sourceKind: "file",
      sourcePath: canonicalPath
    };
  }
}

function failedCheck(source: SourceFailure): CheckClarityResult {
  return {
    ok: false,
    error: source.error,
    source_kind: source.sourceKind,
    source_path: source.sourcePath,
    character_count: 0,
    word_count: 0,
    sentence_count: 0,
    average_sentence_length: 0,
    clarity_score: 0,
    clarity_label: "ללא טקסט",
    long_sentence_count: 0,
    passive_count: 0,
    complex_term_count: 0,
    issue_count: 0,
    complex_sentence_count: 0,
    complex_sentences_returned: 0,
    complex_sentences_omitted: 0,
    complex_sentences: [],
    summary_text: source.error.message
  };
}

function failedList(source: SourceFailure): ListIssuesResult {
  return {
    ok: false,
    error: source.error,
    source_kind: source.sourceKind,
    source_path: source.sourcePath,
    character_count: 0,
    issue_count: 0,
    issues_returned: 0,
    issues_omitted: 0,
    issues: [],
    summary_text: source.error.message
  };
}

export async function checkClarity(
  input: TextSourceInput,
  fs: LocalFileSystem = nodeFileSystem
): Promise<CheckClarityResult> {
  const source = await loadSource(input, fs);
  if (!source.ok) {
    return failedCheck(source);
  }
  const analysis = analyzeText(source.text);
  const baseSummary = analysis.word_count === 0
    ? "לא נמצא טקסט לניתוח."
    : `ציון הבהירות הוא ${analysis.clarity_score}, ברמה ${analysis.clarity_label}, ונמצאו ${analysis.issue_count} בעיות.`;
  const summary = analysis.complex_sentences_omitted === 0
    ? baseSummary
    : `${baseSummary} מוצגים ${analysis.complex_sentences_returned} משפטים מסומנים, והושמטו ${analysis.complex_sentences_omitted} בגלל מגבלת הפלט.`;
  return {
    ok: true,
    error: null,
    source_kind: source.sourceKind,
    source_path: source.sourcePath,
    character_count: analysis.character_count,
    word_count: analysis.word_count,
    sentence_count: analysis.sentence_count,
    average_sentence_length: analysis.average_sentence_length,
    clarity_score: analysis.clarity_score,
    clarity_label: analysis.clarity_label,
    long_sentence_count: analysis.long_sentence_count,
    passive_count: analysis.passive_count,
    complex_term_count: analysis.complex_term_count,
    issue_count: analysis.issue_count,
    complex_sentence_count: analysis.complex_sentence_count,
    complex_sentences_returned: analysis.complex_sentences_returned,
    complex_sentences_omitted: analysis.complex_sentences_omitted,
    complex_sentences: analysis.complex_sentences,
    summary_text: summary
  };
}

export async function listIssues(
  input: TextSourceInput,
  fs: LocalFileSystem = nodeFileSystem
): Promise<ListIssuesResult> {
  const source = await loadSource(input, fs);
  if (!source.ok) {
    return failedList(source);
  }
  const analysis = analyzeText(source.text);
  return {
    ok: true,
    error: null,
    source_kind: source.sourceKind,
    source_path: source.sourcePath,
    character_count: analysis.character_count,
    issue_count: analysis.issue_count,
    issues_returned: analysis.issues_returned,
    issues_omitted: analysis.issues_omitted,
    issues: analysis.issues,
    summary_text: analysis.issue_count === 0
      ? "לא נמצאו בעיות בהירות לפי הכללים המקומיים."
      : analysis.issues_omitted === 0
        ? `נמצאו ${analysis.issue_count} בעיות בהירות לפי הכללים המקומיים.`
        : `נמצאו ${analysis.issue_count} בעיות בהירות. מוצגות ${analysis.issues_returned}, והושמטו ${analysis.issues_omitted} בגלל מגבלת הפלט.`
  };
}
