import assert from "node:assert/strict";
import test from "node:test";
import { organizeTasks, rankTasks } from "../src/scheduler.js";
import type { ParsedTask } from "../src/types.js";

test("orders by urgency, score, shorter duration, then original order", () => {
  const tasks: ParsedTask[] = [
    {
      id: "a",
      text: "a",
      original_index: 0,
      urgency_score: 40,
      urgency: "medium",
      estimated_minutes: 30,
      duration_source: "explicit",
      source_signals: []
    },
    {
      id: "b",
      text: "b",
      original_index: 1,
      urgency_score: 70,
      urgency: "high",
      estimated_minutes: 60,
      duration_source: "explicit",
      source_signals: []
    },
    {
      id: "c",
      text: "c",
      original_index: 2,
      urgency_score: 40,
      urgency: "medium",
      estimated_minutes: 10,
      duration_source: "explicit",
      source_signals: []
    },
    {
      id: "d",
      text: "d",
      original_index: 3,
      urgency_score: 40,
      urgency: "medium",
      estimated_minutes: 10,
      duration_source: "explicit",
      source_signals: []
    }
  ];

  assert.deepEqual(rankTasks(tasks).map((task) => task.id), ["b", "c", "d", "a"]);
});

test("skips an oversized task and continues filling useful smaller work", () => {
  const result = organizeTasks({
    raw_text: "דחוף לשלוח טופס היום, 20 דקות\nלהכין מצגת למחר, שעה\nלקנות חלב, 15 דקות",
    available_minutes: 75,
    start_time: "09:00",
    language_hint: "he"
  });

  assert.deepEqual(result.schedule.map((item) => item.id), ["task-01", "task-03"]);
  assert.deepEqual(result.unscheduled.map((item) => item.id), ["task-02"]);
  assert.equal(result.total_minutes_used, 35);
  assert.equal(result.total_minutes_remaining, 40);
  assert.deepEqual(
    result.schedule.map((item) => [item.start_time, item.end_time]),
    [
      ["09:00", "09:20"],
      ["09:20", "09:35"]
    ]
  );
});

test("handles zero available minutes and exact fits", () => {
  const zero = organizeTasks({
    raw_text: "task, 15 min",
    available_minutes: 0,
    start_time: "09:00",
    language_hint: "en"
  });
  assert.equal(zero.schedule.length, 0);
  assert.equal(zero.unscheduled.length, 1);

  const exact = organizeTasks({
    raw_text: "task, 15 min",
    available_minutes: 15,
    start_time: "09:00",
    language_hint: "en"
  });
  assert.equal(exact.schedule.length, 1);
  assert.equal(exact.total_minutes_remaining, 0);
});

test("reports day offsets when a schedule crosses midnight", () => {
  const result = organizeTasks({
    raw_text: "late task, 30 min",
    available_minutes: 30,
    start_time: "23:50",
    language_hint: "en"
  });
  assert.equal(result.schedule[0]?.start_time, "23:50");
  assert.equal(result.schedule[0]?.end_time, "00:20");
  assert.equal(result.schedule[0]?.end_day_offset, 1);
});
