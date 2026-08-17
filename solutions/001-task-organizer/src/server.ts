#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { formatOrganizeResult, formatParseResult } from "./format.js";
import { parseTasks } from "./parser.js";
import {
  organizeInputSchema,
  organizeResultSchema,
  parseInputSchema,
  parseResultSchema
} from "./schemas.js";
import { organizeTasks } from "./scheduler.js";

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "everyday_dayplan_mcp", version: "1.0.0" },
    {
      instructions:
        "Use dayplan_organize_tasks to turn user-provided Hebrew or English tasks into a deterministic local schedule. The tools are read-only, make no network requests, do not access calendars or files, and never perform the tasks. Explain that missing durations default to 15 minutes."
    }
  );

  server.registerTool(
    "dayplan_parse_tasks",
    {
      title: "Parse everyday tasks",
      description:
        "Parse user-provided Hebrew or English task text into transparent durations, urgency scores, and source signals. Use for inspection before scheduling. This local read-only tool does not access files, calendars, accounts, or the network.",
      inputSchema: parseInputSchema,
      outputSchema: parseResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ raw_text, language_hint }) => {
      const output = parseTasks(raw_text, language_hint);
      return {
        content: [{ type: "text", text: formatParseResult(output) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "dayplan_organize_tasks",
    {
      title: "Build a simple day plan",
      description:
        "Turn user-provided Hebrew or English tasks into a deterministic local schedule using urgency, estimated duration, available minutes, and stable tie-breaks. Use when the user wants a suggested plan only. This read-only tool does not change a calendar, send messages, edit files, or use the network.",
      inputSchema: organizeInputSchema,
      outputSchema: organizeResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ raw_text, language_hint, available_minutes, start_time }) => {
      const output = organizeTasks({ raw_text, language_hint, available_minutes, start_time });
      return {
        content: [{ type: "text", text: formatOrganizeResult(output) }],
        structuredContent: output
      };
    }
  );

  return server;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === path.resolve(invokedPath)) {
  void serveStdio(createServer);
}
