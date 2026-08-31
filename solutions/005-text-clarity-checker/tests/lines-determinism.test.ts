import assert from "node:assert/strict";
import test from "node:test";
import { checkClarity, listIssues } from "../src/analyzer.js";

test("mixed Hebrew and English text keeps one-based source line numbers", async () => {
  const longLine = Array.from({ length: 41 }, (_, index) => `item${index + 1}`).join(" ");
  const text = [
    "שורה קצרה וברורה.",
    `${longLine}.`,
    "The report was completed yesterday.",
    "המונח סינרגיה מופיע כאן."
  ].join("\n");
  const result = await listIssues({ text });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.issues.map((issue) => [issue.line, issue.type]),
    [
      [2, "long_sentence"],
      [3, "passive_voice"],
      [4, "complex_term"]
    ]
  );
});

test("clean text produces an empty issue list", async () => {
  const result = await listIssues({ text: "כתבו משפט קצר. בחרו מילה פשוטה." });
  assert.equal(result.ok, true);
  assert.equal(result.issue_count, 0);
  assert.deepEqual(result.issues, []);
});

test("two runs over identical input are deeply identical", async () => {
  const input = { text: "The document was completed. נוצרה סינרגיה." };
  const first = await checkClarity(input);
  const second = await checkClarity(input);
  assert.deepEqual(second, first);
});

test("exactly one input source is required without rejecting an empty text value", async () => {
  const noSource = await checkClarity({});
  const twoSources = await checkClarity({ text: "", file_path: "note.txt" });
  const emptyText = await checkClarity({ text: "" });
  assert.equal(noSource.error?.code, "invalid_input");
  assert.equal(twoSources.error?.code, "invalid_input");
  assert.equal(emptyText.ok, true);
  assert.equal(emptyText.clarity_score, 0);
});
