import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const SERVER_PATH = fileURLToPath(new URL("../src/server.js", import.meta.url));

test("real stdio MCP exposes three read-only tools and structuredContent", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "calendar-mcp-"));
  const client = new Client({ name: "calendar-test-client", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_PATH] });
  try {
    await writeFile(path.join(directory, "calendar.ics"), [
      "BEGIN:VCALENDAR", "VERSION:2.0",
      "BEGIN:VEVENT", "UID:first", "SUMMARY:First", "DTSTART:20260910T090000Z", "DTEND:20260910T100000Z", "END:VEVENT",
      "BEGIN:VEVENT", "UID:second", "SUMMARY:Second", "DTSTART:20260910T093000Z", "DTEND:20260910T103000Z", "END:VEVENT",
      "END:VCALENDAR", ""
    ].join("\r\n"), "utf8");

    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      ["check_overlap", "find_conflicts", "list_events"]
    );
    assert.ok(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true));
    assert.ok(listed.tools.every((tool) => tool.annotations?.destructiveHint === false));
    assert.ok(listed.tools.every((tool) => tool.annotations?.idempotentHint === true));
    assert.ok(listed.tools.every((tool) => tool.annotations?.openWorldHint === false));

    const common = {
      working_directory: directory,
      files: ["calendar.ics"],
      window_start: "2026-09-01T00:00:00Z",
      window_end: "2026-09-30T00:00:00Z"
    };
    const conflictsResponse = await client.callTool({ name: "find_conflicts", arguments: common });
    assert.notEqual(conflictsResponse.isError, true);
    const conflicts = conflictsResponse.structuredContent as { ok?: boolean; conflict_count?: number };
    assert.equal(conflicts.ok, true);
    assert.equal(conflicts.conflict_count, 1);
    const readable = conflictsResponse.content.find((item) => item.type === "text");
    assert.equal(readable?.type, "text");
    if (readable?.type === "text") assert.match(readable.text, /"conflict_count": 1/);

    const eventsResponse = await client.callTool({ name: "list_events", arguments: common });
    const events = eventsResponse.structuredContent as { event_count?: number };
    assert.equal(events.event_count, 2);

    const overlapResponse = await client.callTool({
      name: "check_overlap",
      arguments: {
        first_start: "2026-09-10T09:00:00Z",
        first_end: "2026-09-10T10:00:00Z",
        second_start: "2026-09-10T09:30:00Z",
        second_end: "2026-09-10T10:30:00Z"
      }
    });
    const overlap = overlapResponse.structuredContent as { overlaps?: boolean; duration_minutes?: number };
    assert.equal(overlap.overlaps, true);
    assert.equal(overlap.duration_minutes, 30);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
