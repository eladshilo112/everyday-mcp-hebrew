import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listEvents } from "../src/calendar.js";

const WINDOW = { window_start: "2026-09-01T00:00:00Z", window_end: "2026-09-30T00:00:00Z" };

test("skips missing DTEND with a clear warning and accepts empty or non-VEVENT calendars", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "calendar-malformed-"));
  try {
    await writeFile(path.join(directory, "broken.ics"), [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:broken", "DTSTART:20260910T090000Z", "END:VEVENT", "END:VCALENDAR"
    ].join("\r\n"), "utf8");
    await writeFile(path.join(directory, "empty.ics"), "", "utf8");
    await writeFile(path.join(directory, "timezone-only.ics"), [
      "BEGIN:VCALENDAR", "BEGIN:VTIMEZONE", "TZID:UTC", "END:VTIMEZONE", "END:VCALENDAR"
    ].join("\r\n"), "utf8");

    const result = await listEvents({
      working_directory: directory,
      files: ["broken.ics", "empty.ics", "timezone-only.ics"],
      ...WINDOW
    });
    assert.equal(result.ok, true);
    assert.equal(result.event_count, 0);
    assert.equal(result.warning_count, 1);
    assert.equal(result.warnings[0]?.code, "missing_dtend");
    assert.match(result.warnings[0]?.message ?? "", /DTEND/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects traversal outside the caller-specified working directory", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "calendar-boundary-"));
  const inside = path.join(parent, "inside");
  await mkdir(inside);
  try {
    await writeFile(path.join(parent, "outside.ics"), "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", "utf8");
    const result = await listEvents({
      working_directory: inside,
      files: ["../outside.ics"],
      ...WINDOW
    });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "outside_working_directory");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("rejects windows longer than 90 days before reading calendars", async () => {
  const result = await listEvents({
    working_directory: process.cwd(),
    files: ["missing.ics"],
    window_start: "2026-01-01T00:00:00Z",
    window_end: "2026-05-01T00:00:00Z"
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_window");
});
