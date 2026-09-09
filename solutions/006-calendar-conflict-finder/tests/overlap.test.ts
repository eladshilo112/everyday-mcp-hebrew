import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkOverlap, findConflicts } from "../src/calendar.js";

const WINDOW = { window_start: "2026-09-01T00:00:00Z", window_end: "2026-09-30T00:00:00Z" };

function calendar(...events: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR", ""].join("\r\n");
}

function event(uid: string, start: string, end: string, summary = uid): string {
  return ["BEGIN:VEVENT", `UID:${uid}`, `SUMMARY:${summary}`, `DTSTART:${start}`, `DTEND:${end}`, "END:VEVENT"].join("\r\n");
}

test("reports overlap in one file and treats touching boundaries as non-conflicting", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "calendar-overlap-"));
  try {
    await writeFile(path.join(directory, "one.ics"), calendar(
      event("a", "20260910T090000Z", "20260910T100000Z"),
      event("b", "20260910T093000Z", "20260910T103000Z"),
      event("c", "20260910T103000Z", "20260910T110000Z")
    ), "utf8");

    const result = await findConflicts({ working_directory: directory, files: ["one.ics"], ...WINDOW });
    assert.equal(result.ok, true);
    assert.equal(result.conflict_count, 1);
    assert.deepEqual(result.conflicts.map((item) => [item.first.uid, item.second.uid]), [["a", "b"]]);

    const touching = checkOverlap({
      first_start: "2026-09-10T09:00:00Z",
      first_end: "2026-09-10T10:00:00Z",
      second_start: "2026-09-10T10:00:00Z",
      second_end: "2026-09-10T11:00:00Z"
    });
    assert.equal(touching.ok, true);
    assert.equal(touching.overlaps, false);
    assert.equal(touching.duration_minutes, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cross-references overlapping events from two files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "calendar-cross-file-"));
  try {
    await writeFile(path.join(directory, "work.ics"), calendar(event("work", "20260912T120000Z", "20260912T130000Z")), "utf8");
    await writeFile(path.join(directory, "study.ics"), calendar(event("study", "20260912T123000Z", "20260912T133000Z")), "utf8");
    const result = await findConflicts({
      working_directory: directory,
      files: ["work.ics", "study.ics"],
      ...WINDOW
    });
    assert.equal(result.conflict_count, 1);
    assert.deepEqual(
      [result.conflicts[0]?.first.source_file, result.conflicts[0]?.second.source_file].sort(),
      ["study.ics", "work.ics"]
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
