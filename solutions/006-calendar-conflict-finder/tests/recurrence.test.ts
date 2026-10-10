import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findConflicts, listEvents } from "../src/calendar.js";

function calendar(...events: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR", ""].join("\r\n");
}

test("expands a weekly event inside the bounded window and finds its conflict", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "calendar-recurrence-"));
  try {
    const recurring = [
      "BEGIN:VEVENT", "UID:weekly", "SUMMARY:Weekly meeting",
      "DTSTART:20260901T090000Z", "DTEND:20260901T100000Z",
      "RRULE:FREQ=WEEKLY;COUNT=6", "END:VEVENT"
    ].join("\r\n");
    const oneOff = [
      "BEGIN:VEVENT", "UID:one-off", "SUMMARY:One off",
      "DTSTART:20260915T093000Z", "DTEND:20260915T103000Z", "END:VEVENT"
    ].join("\r\n");
    await writeFile(path.join(directory, "repeat.ics"), calendar(recurring, oneOff), "utf8");
    const result = await findConflicts({
      working_directory: directory,
      files: ["repeat.ics"],
      window_start: "2026-09-01T00:00:00Z",
      window_end: "2026-10-01T00:00:00Z"
    });
    assert.equal(result.ok, true);
    assert.equal(result.conflict_count, 1);
    assert.deepEqual(
      [result.conflicts[0]?.first.uid, result.conflicts[0]?.second.uid].sort(),
      ["one-off", "weekly"]
    );
    const recurringEvent = result.conflicts[0]?.first.uid === "weekly" ? result.conflicts[0].first : result.conflicts[0]?.second;
    assert.equal(recurringEvent?.occurrence_index, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("parses all-day events and normalizes supported differing TZID values", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "calendar-timezone-"));
  try {
    const content = calendar(
      ["BEGIN:VEVENT", "UID:all-day", "SUMMARY:All day", "DTSTART;VALUE=DATE:20260920", "DTEND;VALUE=DATE:20260921", "END:VEVENT"].join("\r\n"),
      ["BEGIN:VEVENT", "UID:new-york", "SUMMARY:New York", "DTSTART;TZID=America/New_York:20260909T090000", "DTEND;TZID=America/New_York:20260909T100000", "END:VEVENT"].join("\r\n"),
      ["BEGIN:VEVENT", "UID:london", "SUMMARY:London", "DTSTART;TZID=Europe/London:20260909T140000", "DTEND;TZID=Europe/London:20260909T150000", "END:VEVENT"].join("\r\n")
    );
    await writeFile(path.join(directory, "zones.ics"), content, "utf8");
    const input = {
      working_directory: directory,
      files: ["zones.ics"],
      window_start: "2026-09-01T00:00:00Z",
      window_end: "2026-09-30T00:00:00Z"
    };
    const listed = await listEvents(input);
    assert.equal(listed.ok, true);
    assert.equal(listed.event_count, 3);
    assert.equal(listed.events.find((item) => item.uid === "all-day")?.all_day, true);

    const conflicts = await findConflicts(input);
    assert.equal(conflicts.conflict_count, 1);
    assert.equal(conflicts.conflicts[0]?.overlap_start, "2026-09-09T13:00:00.000Z");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
