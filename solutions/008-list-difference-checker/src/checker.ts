import { Buffer } from "node:buffer";
import {
  compareInputSchema, LIMITS,
  type Comparison, type Failure, type Group, type InputStats, type Occurrence, type Options
} from "./schemas.js";

type Side = "left" | "right";
type Index = Map<string, Occurrence[]>;
type Entry = { key: string; left: Occurrence[]; right: Occurrence[] };
type Measured = { utf8_bytes: number; lines: number };

function measure(text: string, side: Side): Measured | Failure {
  // No splitting, normalization, or key allocation until BOTH inputs pass limits.
  const utf8_bytes = Buffer.byteLength(text, "utf8");
  if (utf8_bytes > LIMITS.input_bytes) {
    return { ok: false, error: { code: "INPUT_TOO_LARGE", input: side,
      message: "Input exceeds the UTF-8 byte limit.", limit: LIMITS.input_bytes, actual: utf8_bytes } };
  }
  let lines = text.length > 0 && !text.endsWith("\n") ? 1 : 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  if (lines > LIMITS.input_lines) {
    return { ok: false, error: { code: "TOO_MANY_LINES", input: side,
      message: "Input exceeds the physical line limit.", limit: LIMITS.input_lines, actual: lines } };
  }
  return { utf8_bytes, lines };
}

function normalize(text: string, options: Options): string {
  let key = options.trim ? text.trim() : text;
  if (options.ascii_case_fold) {
    key = key.replace(/[A-Z]/g, character => String.fromCharCode(character.charCodeAt(0) + 32));
  }
  return options.nfc ? key.normalize("NFC") : key;
}

function indexText(text: string, side: Side, options: Options, measured: Measured): { index: Index; stats: InputStats } {
  const index: Index = new Map();
  let start = 0;
  let items = 0;
  for (let line = 1; line <= measured.lines; line += 1) {
    const newline = text.indexOf("\n", start);
    let end = newline === -1 ? text.length : newline;
    // A bare CR is ordinary item text; only the CR in a CRLF delimiter is removed.
    if (newline !== -1 && end > start && text.charCodeAt(end - 1) === 13) end -= 1;
    const original = text.slice(start, end);
    start = newline === -1 ? text.length : newline + 1;
    const key = normalize(original, options);
    if (key.length === 0) continue;
    const occurrence: Occurrence = { side, line, text: original };
    const previous = index.get(key);
    if (previous === undefined) index.set(key, [occurrence]);
    else previous.push(occurrence);
    items += 1;
  }
  let duplicate_groups = 0;
  let duplicate_occurrences = 0;
  for (const occurrences of index.values()) {
    if (occurrences.length > 1) {
      duplicate_groups += 1;
      duplicate_occurrences += occurrences.length;
    }
  }
  return { index, stats: { ...measured, ignored_lines: measured.lines - items, items,
    distinct_items: index.size, duplicate_groups, duplicate_occurrences, extra_occurrences: items - index.size } };
}

function* membership(index: Index, other: Index, side: Side, shared: boolean): Generator<Entry> {
  for (const [key, occurrences] of index) {
    const matches = other.get(key);
    if ((matches !== undefined) !== shared) continue;
    yield { key, left: side === "left" ? occurrences : [], right: side === "right" ? occurrences : (matches ?? []) };
  }
}

function* duplicates(index: Index, side: Side): Generator<Entry> {
  for (const [key, occurrences] of index) {
    if (occurrences.length > 1) yield { key, left: side === "left" ? occurrences : [], right: side === "right" ? occurrences : [] };
  }
}

function renderGroup(entries: Iterable<Entry>, budget: { remaining: number }): Group {
  const group: Group = { total_items: 0, returned_items: 0, omitted_items: 0,
    total_occurrences: 0, returned_occurrences: 0, omitted_occurrences: 0, truncated: false, items: [] };
  for (const entry of entries) {
    const total = entry.left.length + entry.right.length;
    group.total_items += 1;
    group.total_occurrences += total;
    if (budget.remaining === 0) continue;
    const occurrences: Occurrence[] = [];
    for (const side of [entry.left, entry.right]) {
      for (const occurrence of side) {
        if (budget.remaining === 0) break;
        occurrences.push(occurrence);
        budget.remaining -= 1;
      }
    }
    const returned = occurrences.length;
    group.items.push({ key: entry.key, left_count: entry.left.length, right_count: entry.right.length,
      total_occurrences: total, returned_occurrences: returned, omitted_occurrences: total - returned,
      truncated: returned < total, occurrences });
    group.returned_occurrences += returned;
  }
  group.returned_items = group.items.length;
  group.omitted_items = group.total_items - group.returned_items;
  group.omitted_occurrences = group.total_occurrences - group.returned_occurrences;
  group.truncated = group.omitted_occurrences > 0;
  return group;
}

/** Pure in-memory comparison. No input is interpreted as a file, command, or formula. */
export function compareLists(raw: unknown): Comparison {
  const parsed = compareInputSchema.safeParse(raw);
  if (!parsed.success) {
    // Do not echo user input, including unknown property names, into error messages.
    return { ok: false, error: { code: "INVALID_ARGUMENTS", input: "arguments",
      message: "Expected left and right strings and optional boolean trim, ascii_case_fold, nfc options; no extra fields." } };
  }
  const { left, right, options } = parsed.data;
  const leftMeasured = measure(left, "left");
  if ("ok" in leftMeasured) return leftMeasured;
  const rightMeasured = measure(right, "right");
  if ("ok" in rightMeasured) return rightMeasured;
  const l = indexText(left, "left", options, leftMeasured);
  const r = indexText(right, "right", options, rightMeasured);
  const budget = { remaining: LIMITS.occurrence_records };
  const left_only = renderGroup(membership(l.index, r.index, "left", false), budget);
  const right_only = renderGroup(membership(r.index, l.index, "right", false), budget);
  const shared = renderGroup(membership(l.index, r.index, "left", true), budget);
  const duplicates_left = renderGroup(duplicates(l.index, "left"), budget);
  const duplicates_right = renderGroup(duplicates(r.index, "right"), budget);
  const total = [left_only, right_only, shared, duplicates_left, duplicates_right]
    .reduce((sum, group) => sum + group.total_occurrences, 0);
  const returned = LIMITS.occurrence_records - budget.remaining;
  return { ok: true, options, inputs: { left: l.stats, right: r.stats },
    left_only, right_only, shared, duplicates_left, duplicates_right,
    reporting: { occurrence_budget: 500, total_occurrence_records: total,
      returned_occurrence_records: returned, omitted_occurrence_records: total - returned, truncated: returned < total } };
}
