import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findConflicts } from "../src/calendar.js";
import { MAX_RETURNED_ITEMS } from "../src/schemas.js";

function crowdedCalendar(count: number): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0"];
  for (let index = count - 1; index >= 0; index -= 1) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:event-${String(index).padStart(3, "0")}`,
      `SUMMARY:Event ${index}`,
      "DTSTART:20260910T090000Z",
      "DTEND:20260910T100000Z",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}

test("repeated local runs are byte-identical, sorted, capped, and make no fetch call", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "calendar-determinism-"));
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("unexpected outbound request");
  }) as typeof fetch;
  try {
    await writeFile(path.join(directory, "crowded.ics"), crowdedCalendar(200), "utf8");
    const input = {
      working_directory: directory,
      files: ["crowded.ics"],
      window_start: "2026-09-01T00:00:00Z",
      window_end: "2026-09-30T00:00:00Z"
    };
    const first = await findConflicts(input);
    const second = await findConflicts(input);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(first.conflict_count, 19_900);
    assert.equal(first.conflicts_returned, MAX_RETURNED_ITEMS);
    assert.equal(first.conflicts_omitted, 19_400);
    assert.equal(first.conflicts.length, MAX_RETURNED_ITEMS);
    assert.equal(fetchCalls, 0);
    const starts = first.conflicts.map((item) => item.overlap_start);
    assert.deepEqual(starts, [...starts].sort());
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
