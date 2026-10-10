import assert from "node:assert/strict";
import test from "node:test";
import { compare } from "./helpers.js";

test("defaults distinguish case, whitespace and canonically equivalent Unicode", () => {
  const result = compare({ left: "A\n apple \né", right: "a\napple\ne\u0301" });
  assert.equal(result.shared.total_items, 0);
  assert.equal(result.left_only.total_items, 3);
  assert.equal(result.right_only.total_items, 3);
  assert.deepEqual(result.options, { trim: false, ascii_case_fold: false, nfc: false });
});

test("trim uses outer ECMAScript whitespace only, including tabs and NBSP", () => {
  const result = compare({ left: "\t apple \u00a0\n \t\n a  b \n\u200b", right: "apple\na b", options: { trim: true } });
  assert.deepEqual(result.shared.items.map(item => item.key), ["apple"]);
  assert.deepEqual(result.shared.items[0]?.occurrences[0], { side: "left", line: 1, text: "\t apple \u00a0" });
  assert.deepEqual(result.left_only.items.map(item => item.key), ["a  b", "\u200b"]);
  assert.equal(result.inputs.left.ignored_lines, 1);
});

test("ASCII case folding never applies locale-sensitive or non-ASCII lowercasing", () => {
  const result = compare({ left: "AZ\nÄ\nΣ\nİ\nß\n Z ", right: "az\nä\nσ\ni\nss\nz", options: { ascii_case_fold: true } });
  assert.deepEqual(result.shared.items.map(item => item.key), ["az"]);
  assert.equal(result.left_only.total_items, 5);
  assert.equal(result.right_only.total_items, 5);
});

test("NFC composes canonical sequences but does not trim, fold case or perform NFKC", () => {
  const result = compare({ left: "é\nＡ\nÉ\n é ", right: "e\u0301\nA\nE\u0301\ne\u0301 ", options: { nfc: true } });
  assert.deepEqual(result.shared.items.map(item => item.key), ["é", "É"]);
  assert.deepEqual(result.left_only.items.map(item => item.key), ["Ａ", " é "]);
});

test("normalization-created duplicates keep original text; trim then ASCII fold then NFC", () => {
  const result = compare({ left: " E\u0301 \né\nÉ\n \nAPPLE\napple ", right: "é\napple",
    options: { trim: true, ascii_case_fold: true, nfc: true } });
  assert.deepEqual(result.shared.items.map(item => item.key), ["é", "apple"]);
  assert.deepEqual(result.duplicates_left.items.map(item => [item.key, item.total_occurrences]), [["é", 2], ["apple", 2]]);
  assert.deepEqual(result.duplicates_left.items[0]?.occurrences, [
    { side: "left", line: 1, text: " E\u0301 " }, { side: "left", line: 2, text: "é" }
  ]);
  // Precomposed É is not ASCII, so it remains distinct even with all options.
  assert.deepEqual(result.left_only.items.map(item => item.key), ["É"]);
  assert.equal(result.inputs.left.ignored_lines, 1);
});

test("each option can be explicitly disabled without altering exact behavior", () => {
  const input = { left: " A\né", right: "a\ne\u0301" };
  assert.deepEqual(compare(input), compare({ ...input, options: { trim: false, ascii_case_fold: false, nfc: false } }));
});
