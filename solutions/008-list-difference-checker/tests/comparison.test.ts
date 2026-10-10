import assert from "node:assert/strict";
import test from "node:test";
import { compare, snapshot } from "./helpers.js";

test("partial overlap preserves original occurrences and first-seen ordering", () => {
  const result = compare({ left: "pear\n\napple\npear\nplum", right: "plum\nkiwi\npear" });
  assert.deepEqual(result.left_only.items.map(item => item.key), ["apple"]);
  assert.deepEqual(result.right_only.items.map(item => item.key), ["kiwi"]);
  assert.deepEqual(result.shared.items.map(item => item.key), ["pear", "plum"]);
  assert.deepEqual(result.shared.items[0]?.occurrences, [
    { side: "left", line: 1, text: "pear" }, { side: "left", line: 4, text: "pear" },
    { side: "right", line: 3, text: "pear" }
  ]);
  assert.deepEqual(result.left_only.items[0]?.occurrences, [{ side: "left", line: 3, text: "apple" }]);
  assert.deepEqual(result.duplicates_left.items[0]?.occurrences, result.shared.items[0]?.occurrences.slice(0, 2));
});

test("membership ignores multiplicity, while duplicate statistics count it exactly", () => {
  const result = compare({ left: "a\na\nb", right: "b\nb\nb\na" });
  assert.equal(result.left_only.total_items, 0);
  assert.equal(result.right_only.total_items, 0);
  assert.deepEqual(result.shared.items.map(item => [item.key, item.left_count, item.right_count]), [["a", 2, 1], ["b", 1, 3]]);
  assert.equal(result.inputs.left.duplicate_occurrences, 2);
  assert.equal(result.inputs.right.duplicate_occurrences, 3);
  assert.equal(result.inputs.left.extra_occurrences, 1);
  assert.equal(result.inputs.right.extra_occurrences, 2);
  assert.equal(result.reporting.total_occurrence_records, 12);
});

test("prototype keys, shell-looking text, Markdown, CSV and formulas are inert", () => {
  const items = ["__proto__", "constructor", "toString", "$(echo synthetic)", "`echo example`", "a,b", "- apple", "1. apple", "=1+1", "C:\\synthetic\\list.txt"];
  const result = compare({ left: items.join("\n"), right: [...items].reverse().join("\n") });
  assert.deepEqual(result.shared.items.map(item => item.key), items);
  assert.equal(result.inputs.left.distinct_items, items.length);
  assert.equal(result.duplicates_left.total_items, 0);
  assert.equal(compare({ left: "- apple\na,b\n1. apple\n=1+1", right: "apple\na\nb\n2" }).shared.total_items, 0);
});

test("repeated and interleaved calls have byte-identical output and no retained state", () => {
  const input = { left: "z\na\nz\nq", right: "q\nb\na\nb" };
  const expected = JSON.stringify(compare(input));
  for (let i = 0; i < 12; i += 1) {
    compare({ left: "other", right: "OTHER", options: { ascii_case_fold: true } });
    assert.equal(JSON.stringify(compare(input)), expected);
  }
  assert.deepEqual(snapshot({ left: "", right: "" }), {
    left_only: [], right_only: [], shared: [], duplicates_left: [], duplicates_right: [],
    input_items: [0, 0], records: [0, 0, 0], truncated: false
  });
});

test("Hebrew, emoji, empty lines and mixed LF/CRLF preserve one-based positions", () => {
  const result = compare({ left: "שלום\r\n\r\n🍎\n \nשלום\r\n", right: "🍎\r\nשלום\n" });
  assert.equal(result.inputs.left.lines, 5);
  assert.equal(result.inputs.left.ignored_lines, 1);
  assert.equal(result.inputs.left.items, 4);
  assert.deepEqual(result.left_only.items[0]?.occurrences, [{ side: "left", line: 4, text: " " }]);
  assert.deepEqual(result.duplicates_left.items[0]?.occurrences.map(item => item.line), [1, 5]);
  assert.equal(result.shared.total_items, 2);
  assert.equal(compare({ left: "\n", right: "\r\n" }).inputs.left.lines, 1);
  assert.equal(compare({ left: "\n", right: "\r\n" }).reporting.returned_occurrence_records, 0);
  assert.deepEqual(compare({ left: "a\rb\rc\r", right: "a\rb\rc" }).left_only.items.map(item => item.key), ["a\rb\rc\r"]);
  assert.equal(compare({ left: "a\u2028b", right: "" }).inputs.left.lines, 1);
});
