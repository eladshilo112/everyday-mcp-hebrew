import assert from "node:assert/strict";
import test from "node:test";
import { compareLists } from "../src/checker.js";
import { failureSchema, LIMITS } from "../src/schemas.js";
import { compare } from "./helpers.js";

test("UTF-8 byte limits accept the boundary and reject one byte over on either side", () => {
  const boundary = "🍎".repeat(65536);
  assert.equal(compare({ left: boundary, right: "" }).inputs.left.utf8_bytes, LIMITS.input_bytes);
  for (const side of ["left", "right"] as const) {
    const failed = failureSchema.parse(compareLists({ left: "", right: "", [side]: boundary + "a" }));
    assert.deepEqual(failed.error, { code: "INPUT_TOO_LARGE", input: side,
      message: "Input exceeds the UTF-8 byte limit.", limit: 262144, actual: 262145 });
  }
  assert.equal(failureSchema.parse(compareLists({ left: " ".repeat(262145), right: "", options: { trim: true } })).error.code, "INPUT_TOO_LARGE");
});

test("line limits count blank physical lines, including final terminators but no phantom line", () => {
  for (const delimiter of ["\n", "\r\n"]) {
    assert.equal(compare({ left: delimiter.repeat(10000), right: "" }).inputs.left.lines, 10000);
    assert.equal(compare({ left: Array(10000).fill("x").join(delimiter), right: "" }).inputs.left.lines, 10000);
    assert.equal(compare({ left: Array(10000).fill("x").join(delimiter) + delimiter, right: "" }).inputs.left.lines, 10000);
    for (const side of ["left", "right"] as const) {
      const failed = failureSchema.parse(compareLists({ left: "", right: "", [side]: delimiter.repeat(10001) }));
      assert.equal(failed.error.code, "TOO_MANY_LINES");
      assert.equal(failed.error.actual, 10001);
      assert.equal(failed.error.input, side);
    }
  }
});

test("500 global record budget counts repeated references across all groups", () => {
  const result = compare({ left: Array(300).fill("x").join("\n"), right: Array(300).fill("x").join("\n") });
  assert.equal(result.shared.total_items, 1);
  assert.equal(result.shared.items[0]?.left_count, 300);
  assert.equal(result.shared.items[0]?.right_count, 300);
  assert.equal(result.shared.items[0]?.occurrences[499]?.line, 200);
  assert.equal(result.shared.items[0]?.occurrences[499]?.side, "right");
  assert.equal(result.shared.items[0]?.omitted_occurrences, 100);
  assert.equal(result.duplicates_left.total_occurrences, 300);
  assert.equal(result.duplicates_left.omitted_items, 1);
  assert.equal(result.duplicates_right.total_occurrences, 300);
  assert.deepEqual(result.reporting, { occurrence_budget: 500, total_occurrence_records: 1200,
    returned_occurrence_records: 500, omitted_occurrence_records: 700, truncated: true });
});

test("budget priority, wholly omitted keys and partial duplicates have explicit counts", () => {
  const result = compare({ left: "a\na\nb\ns\ns", right: "c\nc\ns\ns" });
  const groups = [result.left_only, result.right_only, result.shared, result.duplicates_left, result.duplicates_right];
  assert.deepEqual(groups.map(group => group.returned_occurrences), [3, 2, 4, 4, 4]);
  assert.equal(result.reporting.total_occurrence_records, 17);
  const unique = compare({ left: Array.from({ length: 501 }, (_, i) => `item${i}`).join("\n"), right: "right" });
  assert.equal(unique.left_only.total_items, 501);
  assert.equal(unique.left_only.returned_items, 500);
  assert.equal(unique.left_only.omitted_items, 1);
  assert.equal(unique.left_only.items[499]?.key, "item499");
  assert.equal(unique.right_only.total_items, 1);
  assert.equal(unique.right_only.omitted_items, 1);
  const partial = compare({ left: Array(251).fill("x").join("\n"), right: "" });
  assert.equal(partial.duplicates_left.items[0]?.returned_occurrences, 249);
  assert.equal(partial.duplicates_left.items[0]?.omitted_occurrences, 2);
  assert.equal(partial.duplicates_left.truncated, true);
  assert.equal(compare({ left: Array(250).fill("x").join("\n"), right: "" }).reporting.truncated, false);
});

test("all aggregate identities hold at maximum line counts and truncation is deterministic", () => {
  const input = { left: "x\n".repeat(10000), right: "x\n".repeat(10000) };
  const result = compare(input);
  assert.equal(result.inputs.left.items, 10000);
  assert.equal(result.inputs.left.extra_occurrences, 9999);
  let returned = 0;
  let total = 0;
  for (const group of [result.left_only, result.right_only, result.shared, result.duplicates_left, result.duplicates_right]) {
    assert.equal(group.total_items, group.returned_items + group.omitted_items);
    assert.equal(group.total_occurrences, group.returned_occurrences + group.omitted_occurrences);
    assert.equal(group.returned_occurrences, group.items.reduce((sum, item) => sum + item.occurrences.length, 0));
    returned += group.returned_occurrences;
    total += group.total_occurrences;
  }
  assert.equal(returned, 500);
  assert.equal(total, 40000);
  assert.equal(result.reporting.omitted_occurrence_records, 39500);
  assert.deepEqual(compare(input), result);
});

test("invalid shapes, types and unknown options fail without leaking supplied content", () => {
  const invalid: unknown[] = [null, [], {}, { left: 1, right: "" }, { left: "x" },
    { left: "", right: "", path: "synthetic-secret" }, { left: "", right: "", options: null },
    { left: "", right: "", options: { trim: "true" } }, { left: "", right: "", options: { locale: "synthetic-secret" } }];
  for (const raw of invalid) {
    const result = failureSchema.parse(compareLists(raw));
    assert.equal(result.error.code, "INVALID_ARGUMENTS");
    assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
  }
});
