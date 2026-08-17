import assert from "node:assert/strict";
import test from "node:test";
import { detectLanguage, parseTasks, urgencyFromScore } from "../src/parser.js";

test("parses Hebrew durations and urgency signals", () => {
  const result = parseTasks(
    "דחוף לשלוח טופס היום, 20 דקות\nלהכין מצגת למחר, שעה\nלקנות חלב, רבע שעה",
    "auto"
  );

  assert.equal(result.language, "he");
  assert.equal(result.tasks.length, 3);
  assert.deepEqual(
    result.tasks.map((task) => [task.estimated_minutes, task.urgency_score, task.urgency]),
    [
      [20, 75, "high"],
      [60, 20, "low"],
      [15, 10, "low"]
    ]
  );
  assert.deepEqual(result.tasks[0]?.source_signals, ["urgent", "today"]);
  assert.equal(result.warnings.length, 0);
});

test("parses English decimal hours, priorities, bullets, and semicolons", () => {
  const result = parseTasks("- urgent P1 submit form, 1.5 hours; * buy milk, 10 min", "en");

  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0]?.estimated_minutes, 90);
  assert.equal(result.tasks[0]?.urgency_score, 85);
  assert.equal(result.tasks[1]?.estimated_minutes, 10);
  assert.equal(result.warnings.length, 0);
});

test("uses a documented default duration and keeps duplicate tasks", () => {
  const result = parseTasks("לשתות מים\nלשתות מים", "he");

  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0]?.estimated_minutes, 15);
  assert.equal(result.tasks[1]?.estimated_minutes, 15);
  assert.equal(result.warnings.length, 2);
  assert.deepEqual(result.tasks.map((task) => task.id), ["task-01", "task-02"]);
});

test("caps excessive embedded durations and reports an empty input", () => {
  const capped = parseTasks("Long task, 30 hours", "en");
  assert.equal(capped.tasks[0]?.estimated_minutes, 1440);
  assert.equal(capped.tasks[0]?.duration_source, "capped");
  assert.equal(capped.warnings[0]?.code, "duration_capped");

  const empty = parseTasks("  \n ; • ", "he");
  assert.deepEqual(empty.tasks, []);
  assert.equal(empty.warnings[0]?.code, "empty_input");
});

test("language detection and score boundaries are deterministic", () => {
  assert.equal(detectLanguage("משימה task", "auto"), "he");
  assert.equal(detectLanguage("task מש", "auto"), "en");
  assert.equal(urgencyFromScore(59), "medium");
  assert.equal(urgencyFromScore(60), "high");
  assert.equal(urgencyFromScore(29), "low");
  assert.equal(urgencyFromScore(30), "medium");
});
