#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { checkOverlap, findConflicts, listEvents } from "./calendar.js";
import {
  formatCheckOverlapResult,
  formatFindConflictsResult,
  formatListEventsResult
} from "./format.js";
import {
  checkOverlapInputSchema,
  checkOverlapResultSchema,
  findConflictsInputSchema,
  findConflictsResultSchema,
  listEventsInputSchema,
  listEventsResultSchema
} from "./schemas.js";

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "everyday_calendar_conflict_finder_mcp", version: "1.0.0" },
    {
      instructions:
        "Read user-selected local .ics files within an explicit working_directory boundary, list event occurrences, and find time overlaps. Recurrence expansion is deterministic and limited to a caller-supplied window of at most 90 days. The server is read-only and idempotent: it never writes, moves, renames, or deletes files. It has no network client, telemetry, account access, login, API key, command execution, or external timezone download. Supported TZID rules are documented in the README; unknown zones produce warnings instead of guessed times."
    }
  );

  server.registerTool(
    "find_conflicts",
    {
      title: "Find local calendar conflicts",
      description:
        "Read one or more local .ics files inside working_directory and return deterministic pairwise overlaps. Touching boundaries are not conflicts. DAILY and WEEKLY RRULE events are expanded only inside the explicit window, which is capped at 90 days. Results are capped with total and omitted counts.",
      inputSchema: findConflictsInputSchema,
      outputSchema: findConflictsResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      const output = await findConflicts(input);
      return {
        content: [{ type: "text", text: formatFindConflictsResult(output) }],
        structuredContent: output,
        isError: !output.ok
      };
    }
  );

  server.registerTool(
    "list_events",
    {
      title: "List local calendar events",
      description:
        "Read local .ics files inside working_directory and list normalized event occurrences in stable order. Malformed events are skipped with structured warnings. The bounded response reports full, returned, and omitted counts.",
      inputSchema: listEventsInputSchema,
      outputSchema: listEventsResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      const output = await listEvents(input);
      return {
        content: [{ type: "text", text: formatListEventsResult(output) }],
        structuredContent: output,
        isError: !output.ok
      };
    }
  );

  server.registerTool(
    "check_overlap",
    {
      title: "Check two time intervals",
      description:
        "Compare two explicit ISO 8601 intervals locally. The tool uses half-open interval semantics, so an end exactly equal to the other start is not an overlap. No file or network access is performed.",
      inputSchema: checkOverlapInputSchema,
      outputSchema: checkOverlapResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      const output = checkOverlap(input);
      return {
        content: [{ type: "text", text: formatCheckOverlapResult(output) }],
        structuredContent: output,
        isError: !output.ok
      };
    }
  );

  return server;
}

function canonicalEntryPath(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

const invokedPath = process.argv[1];
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath !== undefined && canonicalEntryPath(modulePath) === canonicalEntryPath(invokedPath)) {
  void serveStdio(createServer);
}
