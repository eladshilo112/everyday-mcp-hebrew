#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { DiskSpaceAnalyzer } from "./analyzer.js";
import { formatLargestItemsResult, formatSummaryResult } from "./format.js";
import {
  getScanSummaryInputSchema,
  getScanSummaryResultSchema,
  listLargestItemsInputSchema,
  listLargestItemsResultSchema,
  scanDirectoryInputSchema,
  scanDirectoryResultSchema
} from "./schemas.js";

export function createServer(): McpServer {
  const analyzer = new DiskSpaceAnalyzer();
  const server = new McpServer(
    { name: "everyday_disk_space_analyzer_mcp", version: "1.0.0" },
    {
      instructions:
        "Analyze logical file sizes from local filesystem metadata only. Run scan_directory first, then list_largest_items or get_scan_summary. Every tool is deterministic, offline, read-only, and non-destructive. The server rejects a symlink as the final root component and never follows symlink entries encountered beneath the canonical root. It never reads file content, writes, deletes, renames, moves, contacts a network, uses telemetry, or requires an account. Successful scan state exists only in this server process."
    }
  );

  server.registerTool(
    "scan_directory",
    {
      title: "Scan a local directory for logical sizes",
      description:
        "Recursively inspect metadata below a user-specified local directory, aggregate logical byte sizes, retain only bounded top-item candidates, and return stable per-path warnings. A symlink root is rejected and symlink entries beneath the canonical root are skipped. The tool never reads file content, writes, deletes, or uses a network.",
      inputSchema: scanDirectoryInputSchema,
      outputSchema: scanDirectoryResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      const output = await analyzer.scanDirectory(input);
      return {
        content: [{ type: "text", text: formatSummaryResult(output) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "list_largest_items",
    {
      title: "List the largest items from the latest scan",
      description:
        "Return the top-N files, directories, or both from the latest successful in-memory scan. Results are sorted by logical size descending with an ordinal relative-path tie-break. This tool is local, read-only, non-destructive, and offline.",
      inputSchema: listLargestItemsInputSchema,
      outputSchema: listLargestItemsResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      const output = analyzer.listLargestItems(input);
      return {
        content: [{ type: "text", text: formatLargestItemsResult(output) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "get_scan_summary",
    {
      title: "Get the latest disk scan summary",
      description:
        "Return counts, aggregate logical size, deterministic warnings, and a human-readable summary for the latest successful scan in this server process. This tool only reads in-memory scan metadata and never changes files or uses a network.",
      inputSchema: getScanSummaryInputSchema,
      outputSchema: getScanSummaryResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const output = analyzer.getScanSummary();
      return {
        content: [{ type: "text", text: formatSummaryResult(output) }],
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
