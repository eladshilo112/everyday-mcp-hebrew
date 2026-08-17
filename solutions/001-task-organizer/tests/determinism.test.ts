import assert from "node:assert/strict";
import test from "node:test";
import { organizeTasks } from "../src/scheduler.js";

const INPUT = {
  raw_text: "דחוף לסיים תשלום היום, 25 דקות\nלהתקשר למרפאה, 10 דקות\nRead for half an hour",
  available_minutes: 60,
  start_time: "08:15",
  language_hint: "auto" as const
};

test("the same normalized input produces byte-identical JSON", () => {
  const first = JSON.stringify(organizeTasks(INPUT));
  for (let index = 0; index < 50; index += 1) {
    assert.equal(JSON.stringify(organizeTasks(INPUT)), first);
  }
});

test("CRLF and LF produce identical results", () => {
  const lf = organizeTasks(INPUT);
  const crlf = organizeTasks({ ...INPUT, raw_text: INPUT.raw_text.replace(/\n/gu, "\r\n") });
  assert.deepEqual(crlf, lf);
});
