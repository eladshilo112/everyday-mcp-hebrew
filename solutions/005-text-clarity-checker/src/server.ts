#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { checkClarity, listIssues } from "./analyzer.js";
import { formatCheckClarityResult, formatListIssuesResult } from "./format.js";
import {
  checkClarityInputSchema,
  checkClarityResultSchema,
  listIssuesInputSchema,
  listIssuesResultSchema
} from "./schemas.js";

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "everyday_text_clarity_checker_mcp", version: "1.0.0" },
    {
      instructions:
        "Analyze either user-supplied text or one user-selected local UTF-8 file with deterministic clarity rules. Supply exactly one of text or file_path. Both tools are read-only, idempotent, and non-destructive. They contain no network client, reject URL and UNC path forms, and never write files, execute commands, use telemetry, access accounts, or use a language model. Select a file on a local volume because mapped drives and remote mounts cannot be identified portably. Input is limited to 200,000 Unicode characters."
    }
  );

  server.registerTool(
    "check_clarity",
    {
      title: "Check text clarity",
      description:
        "Return a deterministic clarity score, average sentence length, passive count, complex-term count, and up to 500 flagged sentence excerpts with explicit total and omitted counts. The input is supplied text or one local UTF-8 regular file. This tool opens the selected file only for reading and contains no network client.",
      inputSchema: checkClarityInputSchema,
      outputSchema: checkClarityResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      const output = await checkClarity(input);
      return {
        content: [{ type: "text", text: formatCheckClarityResult(output) }],
        structuredContent: output,
        isError: !output.ok
      };
    }
  );

  server.registerTool(
    "list_issues",
    {
      title: "List clarity issues",
      description:
        "List up to 500 deterministic clarity findings with explicit total and omitted counts, one-based source line numbers, stable issue types, Hebrew labels, bounded sentence excerpts, and matched passive or complex terms. This tool is read-only, non-destructive, and contains no network client.",
      inputSchema: listIssuesInputSchema,
      outputSchema: listIssuesResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      const output = await listIssues(input);
      return {
        content: [{ type: "text", text: formatListIssuesResult(output) }],
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
if (
  invokedPath !== undefined &&
  canonicalEntryPath(modulePath) === canonicalEntryPath(invokedPath)
) {
  void serveStdio(createServer);
}
