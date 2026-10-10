import assert from "node:assert/strict";
import test from "node:test";
import { analyzeText } from "../src/analyzer.js";

test("empty and whitespace-only text return stable zero values", () => {
  for (const text of ["", "   \n\t\r\n "]) {
    const result = analyzeText(text);
    assert.equal(result.word_count, 0);
    assert.equal(result.sentence_count, 0);
    assert.equal(result.average_sentence_length, 0);
    assert.equal(result.clarity_score, 0);
    assert.equal(result.clarity_label, "ללא טקסט");
    assert.equal(result.issue_count, 0);
  }
});

test("one short sentence is clear and unflagged", () => {
  const result = analyzeText("ההודעה קצרה וברורה.");
  assert.equal(result.word_count, 3);
  assert.equal(result.sentence_count, 1);
  assert.equal(result.average_sentence_length, 3);
  assert.equal(result.clarity_score, 100);
  assert.equal(result.clarity_label, "ברור");
  assert.deepEqual(result.issues, []);
});

test("Hebrew combining marks stay attached to their base word", () => {
  const result = analyzeText("שָׁלוֹם עוֹלָם.");
  assert.equal(result.word_count, 2);
  assert.equal(result.sentence_count, 1);
  assert.equal(result.average_sentence_length, 2);
  assert.equal(result.issue_count, 0);
});

test("a sentence above forty words is marked as too long", () => {
  const text = `${Array.from({ length: 41 }, (_, index) => `word${index + 1}`).join(" ")}.`;
  const result = analyzeText(text);
  assert.equal(result.long_sentence_count, 1);
  assert.equal(result.complex_sentences.length, 1);
  assert.deepEqual(result.complex_sentences[0]?.issue_types, ["long_sentence"]);
  assert.equal(result.issues[0]?.type, "long_sentence");
  assert.match(result.issues[0]?.message_he ?? "", /ארוך מדי/u);
});

test("passive wording and fixed jargon are reported separately", () => {
  const result = analyzeText("המסמך נכתב על ידי הצוות במסגרת אופטימיזציה.");
  assert.equal(result.passive_count, 1);
  assert.equal(result.complex_term_count, 1);
  assert.deepEqual(
    result.issues.map((issue) => issue.type),
    ["passive_voice", "complex_term"]
  );
  assert.equal(result.issues[0]?.match, "נכתב על ידי");
  assert.equal(result.issues[1]?.match, "אופטימיזציה");
});
