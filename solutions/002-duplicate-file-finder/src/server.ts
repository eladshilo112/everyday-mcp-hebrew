#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { findDuplicates, suggestCleanup } from "./duplicates.js";
import { formatCleanupResult, formatDuplicatesResult, formatScanResult } from "./format.js";
import {
  findDuplicatesResultSchema,
  scanDirectoryInputSchema,
  scanDirectoryResultSchema,
  scanReferenceInputSchema,
  suggestCleanupResultSchema
} from "./schemas.js";
import { scanDirectory } from "./scanner.js";

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "everyday_duplicate_file_finder_mcp", version: "1.0.0" },
    {
      instructions:
        "Use scan_directory first, then find_duplicates and suggest_cleanup. All tools are deterministic, local, read-only, and offline. They never delete, move, rename, or modify files. Symlinks are not followed. Scan state is retained only in this server process. Ask the user to review every cleanup candidate manually."
    }
  );

  server.registerTool(
    "scan_directory",
    {
      title: "Scan a local directory for duplicate content",
      description:
        "Read file content in a user-specified local directory, calculate SHA-256 hashes, and retain the bounded result in process memory. The scan skips symlinks and oversized files, uses no account or credential, writes nothing, and makes no network requests.",
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
      const output = await scanDirectory(input);
      return {
        content: [{ type: "text", text: formatScanResult(output) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "find_duplicates",
    {
      title: "List duplicate groups from a completed scan",
      description:
        "Group files from a previous in-memory scan by identical SHA-256 content hash. Results use stable relative path ordering. This local tool is read-only, needs no account or credential, writes nothing, and makes no network requests.",
      inputSchema: scanReferenceInputSchema,
      outputSchema: findDuplicatesResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ scan_id }) => {
      const output = findDuplicates(scan_id);
      return {
        content: [{ type: "text", text: formatDuplicatesResult(output) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "suggest_cleanup",
    {
      title: "Propose a manual duplicate cleanup plan",
      description:
        "Propose keeping the first stable relative path in each duplicate group and manually reviewing the remaining copies. This advisory tool never deletes, moves, renames, or modifies a file, needs no account or credential, writes nothing, and makes no network requests.",
      inputSchema: scanReferenceInputSchema,
      outputSchema: suggestCleanupResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ scan_id }) => {
      const output = suggestCleanup(scan_id);
      return {
        content: [{ type: "text", text: formatCleanupResult(output) }],
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
